import {
  beginGeneration,
  getOrderById,
  markOrderPaid,
  markOrderPaymentMismatch,
  markOrderPaymentStatus,
  recordPaymentAnomaly,
} from "./db";
import { logEvent } from "./logger";
import { enqueueEmail } from "./outbox";
import { fromStripeMinorAmount, retrieveCheckoutSession, type StripeCheckoutSession } from "./stripe";
import type { Env, OrderRow, OrderStatusChangeSource } from "./types";

export type CheckoutCompletionOutcome =
  | "paid"
  | "already_paid"
  | "not_settled"
  | "expired"
  | "mismatch_refund_requested"
  | "ignored";

const SETTLED_ELSEWHERE = new Set([
  "refunded",
  "partially_refunded",
  "chargeback_open",
  "chargeback_lost",
  "chargeback_won",
  "amount_mismatch",
  "currency_mismatch",
]);

/** Idempotent follow-up for a paid order; safe on every duplicate delivery. */
async function activatePaidOrder(env: Env, order: OrderRow) {
  await beginGeneration(env, order.id);
  await enqueueEmail(env, {
    kind: "order_confirmation",
    dedupeKey: `order-confirmation:${order.id}`,
    orderId: order.id,
  });
}

/**
 * Applies the authoritative Checkout Session state to an order. Used by both the
 * webhook and the reconciliation job, so a lost webhook cannot strand a payment.
 */
export async function applyCheckoutSession(
  env: Env,
  session: StripeCheckoutSession,
  source: Extract<OrderStatusChangeSource, "webhook" | "cron">,
  eventId: string | null = null,
): Promise<CheckoutCompletionOutcome> {
  const paid = session.payment_status === "paid";
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    logEvent("suspicious_payment_event", { reason: "missing_order_metadata", source });
    if (paid) await recordPaymentAnomaly(env, { orderId: null, stripeObjectId: session.id, reason: "paid_without_order_metadata", eventId });
    return "ignored";
  }

  let order = await getOrderById(env, orderId);
  if (!order) {
    logEvent("suspicious_payment_event", { reason: "unknown_order", source });
    if (paid) await recordPaymentAnomaly(env, { orderId: null, stripeObjectId: session.id, reason: "paid_unknown_order", eventId });
    return "ignored";
  }

  if (order.payment_status === "paid") {
    await activatePaidOrder(env, order);
    return "already_paid";
  }
  if (SETTLED_ELSEWHERE.has(order.payment_status)) {
    return "ignored";
  }

  if (
    session.mode !== "payment" ||
    (session.client_reference_id && session.client_reference_id !== order.id) ||
    session.metadata.selectedPackage !== order.selected_package ||
    (order.stripe_session_id && order.stripe_session_id !== session.id)
  ) {
    logEvent("suspicious_payment_event", { orderId, reason: "checkout_identity_mismatch", source });
    if (paid) await recordPaymentAnomaly(env, { orderId, stripeObjectId: session.id, reason: "checkout_identity_mismatch", eventId });
    return "ignored";
  }

  if (!paid) {
    if (session.status === "expired") {
      await markOrderPaymentStatus(env, order.id, "expired", { source });
      return "expired";
    }
    logEvent("payment_not_settled", { orderId, source });
    return "not_settled";
  }

  const mismatchInput = {
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
    paidAmount: null as number | null,
  };
  if (session.currency?.toLowerCase() !== order.currency.toLowerCase()) {
    await markOrderPaymentMismatch(env, order.id, "currency_mismatch", mismatchInput);
    await recordPaymentAnomaly(env, { orderId, stripeObjectId: session.id, reason: "currency_mismatch", eventId });
    logEvent("currency_mismatch", { orderId, source });
    return "mismatch_refund_requested";
  }
  const paidAmount = fromStripeMinorAmount(session.amount_total, session.currency);
  if (paidAmount !== order.server_calculated_price) {
    await markOrderPaymentMismatch(env, order.id, "amount_mismatch", { ...mismatchInput, paidAmount });
    await recordPaymentAnomaly(env, { orderId, stripeObjectId: session.id, reason: "amount_mismatch", eventId });
    logEvent("amount_mismatch", { orderId, source });
    return "mismatch_refund_requested";
  }

  const stripeCustomerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  if (stripeCustomerEmail && order.billing_email && stripeCustomerEmail.toLowerCase() !== order.billing_email.toLowerCase()) {
    // The session identity is already proven by the server-side retrieval above.
    // A different receipt address must not strand a completed payment.
    logEvent("checkout_customer_email_differs", { orderId, source });
  }
  if (order.payment_status === "cancelled" || order.payment_status === "expired") {
    await recordPaymentAnomaly(env, { orderId, stripeObjectId: session.id, reason: "paid_after_local_cancel", eventId, resolved: true });
  }

  const changed = await markOrderPaid(env, order.id, {
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
    paidAmount,
    source,
  });
  order = (await getOrderById(env, order.id)) ?? order;
  if (order.payment_status !== "paid") return "ignored";
  if (changed) logEvent("payment_paid", { orderId: order.id, source });
  await activatePaidOrder(env, order);
  return changed ? "paid" : "already_paid";
}

export async function completeCheckoutSession(
  env: Env,
  sessionId: string,
  source: Extract<OrderStatusChangeSource, "webhook" | "cron">,
  eventId: string | null = null,
) {
  if (!sessionId || !sessionId.startsWith("cs_")) {
    logEvent("suspicious_payment_event", { reason: "invalid_session_id", source });
    return "ignored" as const;
  }
  const session = await retrieveCheckoutSession(env, sessionId);
  return applyCheckoutSession(env, session, source, eventId);
}

const RECONCILE_AFTER_MS = 10 * 60_000;
const RECONCILE_WINDOW_MS = 48 * 3600_000;

/** Catches payments whose webhook never arrived (misconfiguration, outage, rotated secret). */
export async function reconcileOpenCheckouts(env: Env, limit = 10) {
  if (env.PAYMENTS_ENABLED !== "true") return { checked: 0, paid: 0 };
  const now = Date.now();
  const due = new Date(now - RECONCILE_AFTER_MS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE orders SET reconcile_checked_at = ?
     WHERE id IN (
       SELECT id FROM orders
       WHERE payment_status IN ('checkout_created', 'failed')
         AND stripe_session_id IS NOT NULL
         AND created_at < ? AND created_at > ?
         AND (reconcile_checked_at IS NULL OR reconcile_checked_at < ?)
       ORDER BY created_at LIMIT ?
     )
     RETURNING id, stripe_session_id`,
  ).bind(new Date(now).toISOString(), due, new Date(now - RECONCILE_WINDOW_MS).toISOString(), due, limit)
    .all<{ id: string; stripe_session_id: string }>();

  let paid = 0;
  for (const row of claimed.results) {
    try {
      const outcome = await completeCheckoutSession(env, row.stripe_session_id, "cron");
      if (outcome === "paid") {
        paid += 1;
        logEvent("checkout_reconciled_paid", { orderId: row.id });
      }
    } catch (error) {
      logEvent("checkout_reconcile_failed", { orderId: row.id, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  return { checked: claimed.results.length, paid };
}
