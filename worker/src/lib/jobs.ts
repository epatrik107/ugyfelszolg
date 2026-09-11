import { generateLetterForPaidOrder } from "./ai";
import { failGeneration } from "./db";
import { sendRefundEmail } from "./email";
import { getInvoiceByOrderId } from "./invoice";
import { logEvent } from "./logger";
import { reconcileStripeRefund } from "./refund";
import { createRefund, retrieveRefund } from "./stripe";
import type { Env, OrderRow } from "./types";

// Scheduled handlers have a 15-minute wall-time budget. A longer claim lease
// prevents a replacement execution overlapping a still-running predecessor.
const LEASE_MS = 20 * 60_000;

export async function processGenerationJobs(env: Env) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const expiredLease = new Date(Date.now() - LEASE_MS).toISOString();
  const runId = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    `UPDATE orders SET ai_status = 'generating',
       generation_count = CASE WHEN ai_status = 'not_started' THEN 1 ELSE generation_count END,
       generation_attempts = generation_attempts + 1,
       generation_claimed_at = ?, generation_run_id = ?, updated_at = ?
     WHERE id IN (
       SELECT id FROM orders WHERE payment_status IN ('paid', 'partially_refunded')
         AND (ai_status = 'generating' OR (ai_status = 'not_started' AND generation_count = 0))
         AND (generation_claimed_at IS NULL OR generation_claimed_at < ?)
         AND personal_data_redacted_at IS NULL AND created_at >= ?
       ORDER BY COALESCE(generation_claimed_at, updated_at) LIMIT 4
     ) RETURNING *`,
  ).bind(now, runId, now, expiredLease, cutoff).all<OrderRow>();
  await Promise.all(claimed.results.map(async (order) => {
    try {
      if ((order.generation_attempts ?? 0) > 3) {
        await failGeneration(env, order.id, "failed", "A levélkészítés ismételten megszakadt.", order.subscription_id, runId);
        return;
      }
      await generateLetterForPaidOrder(env, order, order.generation_feedback ?? undefined);
    } catch (error) {
      // Keep the claim: after lease expiry another scheduled execution recovers it.
      logEvent("generation_job_interrupted", { orderId: order.id, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }));
  return claimed.results.length;
}

export async function processRefundJobs(env: Env) {
  const now = new Date().toISOString();
  const lease = new Date(Date.now() - LEASE_MS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE orders SET refund_claimed_at = ?, refund_attempt_count = refund_attempt_count + 1
     WHERE id IN (
       SELECT id FROM orders WHERE refund_requested_at IS NOT NULL
         AND refund_manual_required = 0 AND payment_status = 'paid'
         AND ai_status IN ('failed', 'failed_review') AND generated_letter IS NULL
         AND generation_count <= 1 AND billing_source = 'checkout'
         AND stripe_payment_intent_id IS NOT NULL
         AND (refund_next_attempt_at IS NULL OR refund_next_attempt_at <= ?)
         AND (refund_claimed_at IS NULL OR refund_claimed_at < ?)
       ORDER BY refund_requested_at LIMIT 10
     ) RETURNING *`,
  ).bind(now, now, lease).all<OrderRow>();
  for (const order of claimed.results) {
    try {
      // Stripe retains idempotency keys for at least 24h. An unknown result
      // must be reconciled by an operator before that guarantee expires.
      if (!order.refund_stripe_id && ((order.refund_attempt_count ?? 0) > 6 ||
          Date.now() - Date.parse(order.refund_requested_at!) > 20 * 3600000)) {
        await requireManualRefund(env, order.id);
        continue;
      }
      const refund = order.refund_stripe_id
        ? await retrieveRefund(env, order.refund_stripe_id)
        : await createRefund(env, order.stripe_payment_intent_id!);
      // Persist the provider ID before reconciliation. Pending refunds are
      // retrieved on retry; they must never create a second refund.
      await env.DB.prepare("UPDATE orders SET refund_stripe_id = ? WHERE id = ?")
        .bind(refund.id, order.id).run();
      const result = await reconcileStripeRefund(env, order, refund, "cron");
      if (result.status === "succeeded") {
        await env.DB.prepare("UPDATE orders SET refund_claimed_at = NULL, refund_next_attempt_at = NULL WHERE id = ?")
          .bind(order.id).run();
        if (result.paymentStatusChanged && result.paymentStatus === "refunded") {
          const invoice = await getInvoiceByOrderId(env, order.id);
          await sendRefundEmail(env, order, invoice?.invoice_number ?? null,
            "A levélgeneráló szolgáltatás technikai hibája miatt a rendelést nem tudtuk teljesíteni.");
        }
      } else if (result.status === "pending") {
        await scheduleRefundRetry(env, order, 5);
      } else {
        await requireManualRefund(env, order.id);
      }
    } catch (error) {
      const attempt = order.refund_attempt_count ?? 1;
      if (!order.refund_stripe_id && attempt >= 6) await requireManualRefund(env, order.id);
      else await scheduleRefundRetry(env, order, [1, 5, 15, 60, 120][Math.min(attempt - 1, 4)]);
      logEvent("refund_job_retry_required", { orderId: order.id, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  return claimed.results.length;
}

async function requireManualRefund(env: Env, orderId: string) {
  await env.DB.prepare("UPDATE orders SET refund_manual_required = 1, refund_claimed_at = NULL WHERE id = ?")
    .bind(orderId).run();
  logEvent("refund_manual_review_required", { orderId });
}

async function scheduleRefundRetry(env: Env, order: OrderRow, minutes: number) {
  await env.DB.prepare("UPDATE orders SET refund_next_attempt_at = ?, refund_claimed_at = NULL WHERE id = ?")
    .bind(new Date(Date.now() + minutes * 60_000).toISOString(), order.id).run();
}
