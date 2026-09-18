import { getOrderByPublicId } from "./db";
import type { OperatorDigestIssue } from "./emailTemplates";
import { retryInvoiceEmailForOrder, retryInvoiceForOrder } from "./invoice";
import { logEvent } from "./logger";
import { enqueueEmail } from "./outbox";
import { REFUND_REASON_MESSAGES, reconcileStripeRefund } from "./refund";
import { listRefundsForPaymentIntent } from "./stripe";
import type { Env, OrderRow } from "./types";

const MAX_IDS_PER_ISSUE = 25;

interface IssueQuery {
  key: string;
  title: string;
  action: string;
  sql: (now: number) => { sql: string; params: unknown[] };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Read-only checks. Each returns one identifier column named `ref`. */
export const OPERATOR_ISSUE_QUERIES: IssueQuery[] = [
  {
    key: "manual_refund",
    title: "Kézi refund szükséges",
    action: "Stripe-ban ellenőrizd a payment intentet, majd futtasd a reconcile_refund vagy retry_refund műveletet.",
    sql: () => ({ sql: "SELECT public_id AS ref FROM orders WHERE refund_manual_required = 1 AND payment_status IN ('paid', 'amount_mismatch', 'currency_mismatch')", params: [] }),
  },
  {
    key: "refund_attention",
    title: "A Stripe refund nem zárult le",
    action: "Stripe Dashboardon rendezd a refundot (failed / canceled / requires_action).",
    sql: () => ({ sql: "SELECT public_id AS ref FROM orders WHERE stripe_refund_status IN ('failed', 'canceled', 'requires_action') AND payment_status NOT IN ('refunded')", params: [] }),
  },
  {
    key: "storno_required",
    title: "Sztornó számla szükséges",
    action: "Állítsd ki a sztornót Számlázz.hu-ban, majd futtasd a mark_storno_done műveletet a sztornó számlaszámmal.",
    sql: () => ({ sql: "SELECT public_id AS ref FROM orders WHERE refund_invoice_status = 'manual_required'", params: [] }),
  },
  {
    key: "invoice_failed",
    title: "A számla kiállítása végleg sikertelen",
    action: "Javítsd a számlázási hibát, majd futtasd a retry_invoice műveletet.",
    sql: () => ({ sql: "SELECT public_id AS ref FROM orders WHERE payment_status = 'paid' AND invoice_status = 'failed'", params: [] }),
  },
  {
    key: "invoice_delayed",
    title: "Teljesített rendelés 6 órája számla nélkül",
    action: "Ellenőrizd a Számlázz.hu elérhetőségét; szükség esetén retry_invoice.",
    sql: (now) => ({ sql: "SELECT public_id AS ref FROM orders WHERE payment_status = 'paid' AND invoice_status IN ('pending', 'retry_required', 'processing') AND generated_at < ?", params: [iso(now - 6 * 3600_000)] }),
  },
  {
    key: "webhook_failed",
    title: "Stripe webhook feldolgozási hiba",
    action: "Nézd meg a Worker logokat és a Stripe webhook delivery listát; a Stripe újraküldi, az egyeztető job 10 percen belül pótolja a fizetéseket.",
    sql: (now) => ({ sql: "SELECT event_id AS ref FROM processed_stripe_events WHERE status = 'failed' OR (status = 'processing' AND updated_at < ?)", params: [iso(now - 15 * 60_000)] }),
  },
  {
    key: "payment_anomaly",
    title: "Nem egyező vagy azonosíthatatlan fizetés",
    action: "Stripe-ban ellenőrizd; rendezés után resolve_anomalies.",
    sql: () => ({ sql: "SELECT COALESCE(o.public_id, a.stripe_object_id) || ' (' || a.reason || ')' AS ref FROM payment_anomalies a LEFT JOIN orders o ON o.id = a.order_id WHERE a.resolved_at IS NULL", params: [] }),
  },
  {
    key: "chargeback_open",
    title: "Nyitott chargeback – válasz szükséges a Stripe-ban",
    action: "Töltsd fel a bizonyítékokat a Stripe Dashboardon a határidő előtt.",
    sql: () => ({ sql: "SELECT public_id AS ref FROM orders WHERE payment_status = 'chargeback_open'", params: [] }),
  },
  {
    key: "generation_backlog",
    title: "Levélgenerálás elakadt vagy torlódik",
    action: "Ellenőrizd a cron futását és a Gemini elérhetőségét; a GENERATION_BATCH_SIZE emelhető.",
    sql: (now) => ({
      sql: `SELECT public_id AS ref FROM orders
            WHERE ai_status = 'generating' AND payment_status IN ('paid', 'partially_refunded')
              AND ((generation_claimed_at IS NOT NULL AND generation_claimed_at < ?)
                OR (generation_claimed_at IS NULL AND COALESCE(generation_next_attempt_at, updated_at) < ?))`,
      params: [iso(now - 25 * 60_000), iso(now - 15 * 60_000)],
    }),
  },
  {
    key: "generation_retrying",
    title: "AI szolgáltató hiba miatt újrapróbált rendelések",
    action: "Ellenőrizd a Gemini kvótát, billinget és státuszt; kimerült újrapróbálás után automatikus refund indul.",
    sql: () => ({ sql: "SELECT public_id AS ref FROM orders WHERE ai_status = 'generating' AND generation_retry_count >= 3", params: [] }),
  },
  {
    key: "generation_failed",
    title: "Sikertelen levélgenerálás az elmúlt 24 órában",
    action: "Ha refund még nem indult, requeue_generation újraindítja; egyébként a refund automatikus.",
    sql: (now) => ({ sql: "SELECT public_id AS ref FROM orders WHERE ai_status IN ('failed', 'failed_review') AND payment_status IN ('paid', 'refunded', 'partially_refunded') AND COALESCE(refund_requested_at, updated_at) > ?", params: [iso(now - 24 * 3600_000)] }),
  },
  {
    key: "email_dead",
    title: "Véglegesen sikertelen tranzakciós email",
    action: "Ellenőrizd a Resend állapotát és a címet; resend_access_link újraküldi a rendelési linket.",
    sql: (now) => ({ sql: "SELECT e.kind || ':' || COALESCE(o.public_id, '-') AS ref FROM email_outbox e LEFT JOIN orders o ON o.id = e.order_id WHERE e.status = 'dead' AND e.kind <> 'operator_digest' AND e.created_at > ?", params: [iso(now - 7 * 86400_000)] }),
  },
  {
    key: "operator_request_failed",
    title: "Sikertelen operátori művelet",
    action: "Nézd meg az operator_requests.result mezőt.",
    sql: (now) => ({ sql: "SELECT action || ':' || public_id AS ref FROM operator_requests WHERE status = 'failed' AND created_at > ?", params: [iso(now - 7 * 86400_000)] }),
  },
];

export async function collectOperatorIssues(env: Env, now = Date.now()): Promise<OperatorDigestIssue[]> {
  const issues: OperatorDigestIssue[] = [];
  for (const query of OPERATOR_ISSUE_QUERIES) {
    const { sql, params } = query.sql(now);
    const rows = await env.DB.prepare(sql).bind(...params).all<{ ref: string }>();
    const refs = rows.results.map((row) => String(row.ref)).sort();
    if (refs.length > 0) {
      issues.push({ key: query.key, title: query.title, action: query.action, count: refs.length, publicIds: refs.slice(0, MAX_IDS_PER_ISSUE) });
    }
  }
  return issues;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** New problems alert immediately; an unchanged set repeats once per day. */
export async function queueOperatorDigest(env: Env, now = Date.now()) {
  const issues = await collectOperatorIssues(env, now);
  if (issues.length === 0) return { issues: 0, queued: false };
  const fingerprint = await sha256Hex(JSON.stringify(issues.map(({ key, count, publicIds }) => [key, count, publicIds])));
  const day = iso(now).slice(0, 10);
  const queued = await enqueueEmail(env, {
    kind: "operator_digest",
    dedupeKey: `operator-digest:${fingerprint.slice(0, 32)}:${day}`,
    payload: { issues, generatedAt: iso(now) },
  });
  if (queued) {
    logEvent("operator_alert_queued", { issues: issues.map(({ key, count }) => `${key}:${count}`) });
  }
  return { issues: issues.length, queued };
}

export async function recordHeartbeat(env: Env, name: string, detail: Record<string, unknown> = {}) {
  await env.DB.prepare(
    `INSERT INTO ops_heartbeat (name, last_run_at, detail) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at, detail = excluded.detail`,
  ).bind(name, new Date().toISOString(), JSON.stringify({ revision: env.BUILD_SHA ?? "local", ...detail })).run();
}

interface OperatorRequestRow {
  id: string;
  action: string;
  public_id: string;
  argument: string | null;
  requested_by: string;
}

class OperatorActionError extends Error {}

async function requireOrder(env: Env, publicId: string) {
  const order = await getOrderByPublicId(env, publicId);
  if (!order) throw new OperatorActionError("order_not_found");
  return order;
}

async function stripeRefundsFor(env: Env, order: OrderRow) {
  if (!order.stripe_payment_intent_id) throw new OperatorActionError("no_payment_intent");
  return listRefundsForPaymentIntent(env, order.stripe_payment_intent_id);
}

async function runOperatorAction(env: Env, request: OperatorRequestRow): Promise<string> {
  const now = new Date().toISOString();
  switch (request.action) {
    case "resend_access_link": {
      const order = await requireOrder(env, request.public_id);
      await enqueueEmail(env, { kind: "access_links", dedupeKey: `operator-access:${request.id}`, orderId: order.id, payload: { orderIds: [order.id] } });
      return "queued";
    }
    case "retry_invoice": {
      const order = await requireOrder(env, request.public_id);
      if (order.payment_status !== "paid" || !order.generated_at) throw new OperatorActionError("not_fulfilled_paid_order");
      return `invoice_${await retryInvoiceForOrder(env, order.id)}`;
    }
    case "retry_invoice_email": {
      const order = await requireOrder(env, request.public_id);
      const invoice = await retryInvoiceEmailForOrder(env, order.id);
      return `invoice_email_${invoice?.email_status ?? "unknown"}`;
    }
    case "mark_storno_done": {
      const order = await requireOrder(env, request.public_id);
      const stornoNumber = request.argument?.trim() ?? "";
      if (!/^[A-Za-z0-9._/-]{3,40}$/u.test(stornoNumber)) throw new OperatorActionError("invalid_storno_number");
      const result = await env.DB.prepare(
        `UPDATE orders SET refund_invoice_status = 'created', storno_invoice_number = ?, updated_at = ?
         WHERE id = ? AND refund_invoice_status = 'manual_required'`,
      ).bind(stornoNumber, now, order.id).run();
      if (result.meta.changes !== 1) throw new OperatorActionError("storno_not_required");
      return "storno_recorded";
    }
    case "reconcile_refund": {
      const order = await requireOrder(env, request.public_id);
      const refunds = await stripeRefundsFor(env, order);
      const refund = refunds.find((item) => item.status === "succeeded") ?? refunds[0];
      if (!refund) return "no_refund_in_stripe";
      await env.DB.prepare("UPDATE orders SET refund_stripe_id = ?, updated_at = ? WHERE id = ?").bind(refund.id, now, order.id).run();
      const result = await reconcileStripeRefund(env, order, refund, "manual");
      if (result.status === "succeeded" || result.status === "pending") {
        await env.DB.prepare("UPDATE orders SET refund_manual_required = 0, refund_claimed_at = NULL, refund_next_attempt_at = NULL WHERE id = ?").bind(order.id).run();
      }
      if (result.paymentStatusChanged && result.paymentStatus === "refunded") {
        await enqueueEmail(env, { kind: "refund_notice", dedupeKey: `refund-notice:${order.id}`, orderId: order.id,
          payload: { reason: REFUND_REASON_MESSAGES[order.refund_reason ?? "generation_failed"] ?? REFUND_REASON_MESSAGES.generation_failed } });
      }
      return `refund_${result.status}`;
    }
    case "retry_refund": {
      const order = await requireOrder(env, request.public_id);
      if (order.refund_manual_required !== 1) throw new OperatorActionError("refund_not_in_manual_review");
      // Only after Stripe confirms nothing was refunded may a new refund request be made.
      const refunds = await stripeRefundsFor(env, order);
      if (refunds.length > 0) throw new OperatorActionError("refund_exists_use_reconcile_refund");
      const result = await env.DB.prepare(
        `UPDATE orders SET refund_manual_required = 0, refund_attempt_count = 0, refund_requested_at = ?,
           refund_claimed_at = NULL, refund_next_attempt_at = NULL, refund_stripe_id = NULL, updated_at = ?
         WHERE id = ? AND refund_manual_required = 1`,
      ).bind(now, now, order.id).run();
      return result.meta.changes === 1 ? "refund_requeued" : "unchanged";
    }
    case "requeue_generation": {
      const order = await requireOrder(env, request.public_id);
      const result = await env.DB.prepare(
        `UPDATE orders
         SET ai_status = 'generating', generation_claimed_at = NULL, generation_run_id = NULL,
             generation_attempts = 0, generation_retry_count = 0, generation_next_attempt_at = NULL,
             generation_last_error = NULL, refund_requested_at = NULL, refund_reason = NULL,
             refund_manual_required = 0, error_message = NULL, updated_at = ?
         WHERE id = ? AND payment_status = 'paid' AND ai_status IN ('failed', 'failed_review')
           AND generated_letter IS NULL AND refund_stripe_id IS NULL AND stripe_refund_status IS NULL
           AND refund_claimed_at IS NULL AND personal_data_redacted_at IS NULL`,
      ).bind(now, order.id).run();
      if (result.meta.changes !== 1) throw new OperatorActionError("not_eligible_refund_started_or_delivered");
      return "generation_requeued";
    }
    case "resolve_anomalies": {
      const argument = request.argument?.trim();
      const result = argument
        ? await env.DB.prepare("UPDATE payment_anomalies SET resolved_at = ? WHERE stripe_object_id = ? AND resolved_at IS NULL").bind(now, argument).run()
        : await env.DB.prepare("UPDATE payment_anomalies SET resolved_at = ? WHERE order_id = ? AND resolved_at IS NULL").bind(now, (await requireOrder(env, request.public_id)).id).run();
      return `resolved_${result.meta.changes}`;
    }
    default:
      throw new OperatorActionError("unknown_action");
  }
}

export async function processOperatorRequests(env: Env, limit = 5) {
  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE operator_requests SET processed_at = ?
     WHERE id IN (SELECT id FROM operator_requests WHERE status = 'pending' AND processed_at IS NULL ORDER BY created_at LIMIT ?)
     RETURNING id, action, public_id, argument, requested_by`,
  ).bind(now, limit).all<OperatorRequestRow>();

  for (const request of claimed.results) {
    let status: "done" | "failed" = "done";
    let result: string;
    try {
      result = await runOperatorAction(env, request);
    } catch (error) {
      status = "failed";
      const code = (error as { code?: unknown })?.code;
      result = error instanceof OperatorActionError
        ? error.message
        : `error_${typeof code === "string" ? code : error instanceof Error ? error.name : "unknown"}`;
    }
    await env.DB.prepare("UPDATE operator_requests SET status = ?, result = ?, processed_at = ? WHERE id = ?")
      .bind(status, result.slice(0, 200), new Date().toISOString(), request.id).run();
    logEvent("operator_request_processed", { action: request.action, publicId: request.public_id, requestedBy: request.requested_by, status, result });
  }
  return claimed.results.length;
}
