import { EmailSendError, sendEmail } from "./email";
import {
  checkoutExpiredEmailHtml,
  contactNotificationEmailHtml,
  operatorDigestEmailHtml,
  orderAccessEmailHtml,
  paymentFailedEmailHtml,
  refundEmailHtml,
  type OperatorDigestIssue,
} from "./emailTemplates";
import { hashToken } from "./hash";
import { logEvent } from "./logger";
import { PACKAGES } from "./packages";
import { buildResultCapabilityUrl } from "./resultUrl";
import type { Env, OrderRow } from "./types";

/**
 * Durable transactional email. Rows hold only non-secret data; capability
 * links are derived from TOKEN_HASH_SECRET at send time. Delivery is
 * at-least-once, so Resend receives a stable idempotency key per row.
 */
export type EmailKind =
  | "order_confirmation"
  | "access_links"
  | "refund_notice"
  | "payment_failed"
  | "checkout_expired"
  | "contact_notification"
  | "operator_digest";

const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 180, 360, 720];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
const SENDING_LEASE_MS = 10 * 60_000;
const ACCESSIBLE_STATUSES = new Set(["paid", "partially_refunded", "chargeback_won"]);

interface OutboxRow {
  id: string;
  dedupe_key: string;
  kind: EmailKind;
  order_id: string | null;
  payload: string | null;
  attempts: number;
  claimed_at: string;
}

class SkipEmail extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function enqueueEmailStatement(
  env: Env,
  input: { kind: EmailKind; dedupeKey: string; orderId?: string | null; payload?: unknown; delayMs?: number },
) {
  const now = new Date();
  return env.DB.prepare(
    `INSERT OR IGNORE INTO email_outbox
       (id, dedupe_key, kind, order_id, payload, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.dedupeKey,
    input.kind,
    input.orderId ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload),
    new Date(now.getTime() + (input.delayMs ?? 0)).toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
}

export async function enqueueEmail(
  env: Env,
  input: Parameters<typeof enqueueEmailStatement>[1],
) {
  const result = await enqueueEmailStatement(env, input).run();
  return result.meta.changes === 1;
}

export function orderResultToken(env: Env, order: Pick<OrderRow, "checkout_idempotency_key">) {
  if (!order.checkout_idempotency_key) return null;
  return hashToken(`checkout-result:${order.checkout_idempotency_key}`, env.TOKEN_HASH_SECRET);
}

function sellerInfo(env: Env) {
  return { sellerName: env.SELLER_NAME ?? "Levélsegéd", sellerAddress: env.SELLER_ADDRESS ?? "" };
}

async function loadOrder(env: Env, orderId: string | null) {
  if (!orderId) throw new SkipEmail("missing_order");
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order) throw new SkipEmail("order_not_found");
  return order;
}

async function accessEntry(env: Env, order: OrderRow) {
  const token = await orderResultToken(env, order);
  if (!token) return null;
  // Verify against the stored hash so a legacy or foreign token is never mailed.
  if (await hashToken(token, env.TOKEN_HASH_SECRET) !== order.result_token_hash) return null;
  return {
    orderUrl: buildResultCapabilityUrl(env.SITE_URL, "sikeres-fizetes", order.public_id, token),
    packageName: PACKAGES[order.selected_package]?.name ?? "Levélírás",
    createdAt: order.created_at,
  };
}

function requireOperatorEmail(env: Env) {
  const recipient = env.OPERATOR_EMAIL?.trim();
  if (!recipient) throw new SkipEmail("operator_email_missing");
  return recipient;
}

async function render(env: Env, row: OutboxRow) {
  const payload = row.payload ? JSON.parse(row.payload) as Record<string, unknown> : {};
  const { sellerName, sellerAddress } = sellerInfo(env);

  switch (row.kind) {
    case "order_confirmation": {
      const order = await loadOrder(env, row.order_id);
      if (!ACCESSIBLE_STATUSES.has(order.payment_status)) throw new SkipEmail(`state_${order.payment_status}`);
      const entry = await accessEntry(env, order);
      if (!entry) throw new SkipEmail("no_capability");
      return {
        to: order.email,
        subject: "Rendelés visszaigazolása – Levélsegéd",
        html: orderAccessEmailHtml({ customerName: order.name, orders: [entry], reason: "confirmation", sellerName, sellerAddress }),
      };
    }
    case "access_links": {
      const orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.filter((id): id is string => typeof id === "string").slice(0, 10) : [];
      const entries = [];
      let recipient: string | null = null;
      let customerName = "";
      for (const orderId of orderIds) {
        const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
        if (!order || order.personal_data_redacted_at) continue;
        // All links in one message must belong to the same recipient.
        if (recipient && order.email !== recipient) continue;
        const entry = await accessEntry(env, order);
        if (!entry) continue;
        recipient = order.email;
        customerName ||= order.name;
        entries.push(entry);
      }
      if (!recipient || entries.length === 0) throw new SkipEmail("no_accessible_orders");
      return {
        to: recipient,
        subject: "Rendelési linkjei – Levélsegéd",
        html: orderAccessEmailHtml({ customerName, orders: entries, reason: "requested", sellerName, sellerAddress }),
      };
    }
    case "refund_notice": {
      const order = await loadOrder(env, row.order_id);
      if (order.payment_status !== "refunded" && order.payment_status !== "partially_refunded") {
        throw new SkipEmail(`state_${order.payment_status}`);
      }
      const invoice = await env.DB.prepare("SELECT invoice_number FROM invoices WHERE order_id = ? LIMIT 1")
        .bind(order.id).first<{ invoice_number: string }>();
      return {
        to: order.email,
        subject: "Visszatérítési értesítő",
        html: refundEmailHtml({
          customerName: order.name,
          invoiceNumber: invoice?.invoice_number ?? null,
          amount: order.refund_amount ?? order.paid_amount ?? order.server_calculated_price,
          currency: order.currency,
          reason: order.ai_status === "failed_review" && order.error_message === "Automatikus minőségellenőrzés sikertelen."
            ? "A levél a javítás után sem felelt meg az automatikus minőségellenőrzésnek. A rendelés összegét visszatérítettük."
            : typeof payload.reason === "string" ? payload.reason : "A megrendelés visszatérítésre került.",
          siteUrl: env.SITE_URL,
          sellerName,
          sellerAddress,
        }),
      };
    }
    case "payment_failed":
    case "checkout_expired": {
      const order = await loadOrder(env, row.order_id);
      // The customer may retry the same Checkout Session and succeed after a decline.
      const stillUnpaid = row.kind === "payment_failed"
        ? ["failed", "expired", "cancelled"].includes(order.payment_status)
        : order.payment_status === "expired";
      if (!stillUnpaid) throw new SkipEmail(`state_${order.payment_status}`);
      return row.kind === "payment_failed"
        ? {
          to: order.email,
          subject: "A fizetés nem sikerült – Levélsegéd",
          html: paymentFailedEmailHtml({ customerName: order.name, amount: order.server_calculated_price, currency: order.currency, siteUrl: env.SITE_URL, sellerName, sellerAddress }),
        }
        : {
          to: order.email,
          subject: "A fizetési munkamenet lejárt – Levélsegéd",
          html: checkoutExpiredEmailHtml({ customerName: order.name, siteUrl: env.SITE_URL, sellerName, sellerAddress }),
        };
    }
    case "contact_notification": {
      const email = String(payload.email ?? "");
      return {
        to: requireOperatorEmail(env),
        subject: "Új kapcsolatfelvételi üzenet – Levélsegéd",
        replyTo: email || undefined,
        html: contactNotificationEmailHtml({
          name: String(payload.name ?? ""),
          email,
          message: String(payload.message ?? ""),
          receivedAt: String(payload.receivedAt ?? ""),
          sellerName,
          sellerAddress,
        }),
      };
    }
    case "operator_digest": {
      const issues = Array.isArray(payload.issues) ? payload.issues as OperatorDigestIssue[] : [];
      if (issues.length === 0) throw new SkipEmail("no_issues");
      return {
        to: requireOperatorEmail(env),
        subject: `[Levélsegéd] Üzemeltetői beavatkozás szükséges (${issues.length})`,
        html: operatorDigestEmailHtml({ issues, generatedAt: String(payload.generatedAt ?? ""), sellerName, sellerAddress }),
      };
    }
    default:
      throw new SkipEmail("unknown_kind");
  }
}

async function finish(env: Env, row: OutboxRow, fields: { status: "sent" | "skipped" | "dead" | "pending"; error?: string | null; messageId?: string | null; nextAttemptAt?: string }) {
  const now = new Date().toISOString();
  // A delivered message no longer needs its personal payload.
  const clearPayload = fields.status === "sent" || fields.status === "skipped";
  await env.DB.prepare(
    `UPDATE email_outbox
     SET status = ?, last_error = ?, provider_message_id = COALESCE(?, provider_message_id),
         next_attempt_at = COALESCE(?, next_attempt_at), claimed_at = NULL,
         sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
         payload = CASE WHEN ? THEN NULL ELSE payload END,
         updated_at = ?
     WHERE id = ? AND status = 'sending' AND claimed_at = ?`,
  ).bind(fields.status, fields.error ?? null, fields.messageId ?? null, fields.nextAttemptAt ?? null,
    fields.status, now, clearPayload ? 1 : 0, now, row.id, row.claimed_at).run();
}

export async function processEmailOutbox(env: Env, limit = 10) {
  const now = new Date();
  const claimedAt = now.toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE email_outbox
     SET status = 'sending', claimed_at = ?, attempts = attempts + 1, updated_at = ?
     WHERE id IN (
       SELECT id FROM email_outbox
       WHERE (status = 'pending' AND next_attempt_at <= ?)
          OR (status = 'sending' AND claimed_at < ?)
       ORDER BY next_attempt_at
       LIMIT ?
     )
     RETURNING id, dedupe_key, kind, order_id, payload, attempts, claimed_at`,
  ).bind(claimedAt, claimedAt, claimedAt, new Date(now.getTime() - SENDING_LEASE_MS).toISOString(), limit)
    .all<OutboxRow>();

  let sent = 0;
  for (const row of claimed.results) {
    try {
      const message = await render(env, row);
      const result = await sendEmail(env, message.to, message.subject, message.html,
        `outbox-${row.dedupe_key}`.slice(0, 256), "replyTo" in message ? message.replyTo : undefined);
      await finish(env, row, { status: "sent", messageId: result.providerMessageId });
      logEvent("email_outbox_sent", { kind: row.kind, orderId: row.order_id, attempts: row.attempts });
      sent += 1;
    } catch (error) {
      if (error instanceof SkipEmail) {
        await finish(env, row, { status: "skipped", error: error.reason });
        logEvent("email_outbox_skipped", { kind: row.kind, orderId: row.order_id, reason: error.reason });
        continue;
      }
      const retryable = error instanceof EmailSendError ? error.retryable || error.status === 409 : false;
      const code = error instanceof EmailSendError
        ? `resend_${error.status ?? "network"}`
        : error instanceof Error ? error.name : "unknown";
      if (retryable && row.attempts < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MINUTES[Math.min(row.attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
        await finish(env, row, { status: "pending", error: code, nextAttemptAt: new Date(Date.now() + delay * 60_000).toISOString() });
        logEvent("email_outbox_retry_scheduled", { kind: row.kind, orderId: row.order_id, attempts: row.attempts, code });
      } else {
        await finish(env, row, { status: "dead", error: code });
        logEvent("email_outbox_dead", { kind: row.kind, orderId: row.order_id, attempts: row.attempts, code });
      }
    }
  }
  return { claimed: claimed.results.length, sent };
}
