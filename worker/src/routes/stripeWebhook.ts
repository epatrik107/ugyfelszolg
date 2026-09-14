import type { Context } from "hono";
import { completeCheckoutSession } from "../lib/checkoutCompletion";
import {
  claimStripeEvent,
  completeStripeEvent,
  failStripeEvent,
  getOrderById,
  getOrderByPaymentIntentId,
  getProcessedStripeEventStatus,
  markOrderPaymentStatus,
  upsertPaymentDispute,
} from "../lib/db";
import { logEvent } from "../lib/logger";
import { enqueueEmail } from "../lib/outbox";
import { REFUND_REASON_MESSAGES, reconcileStripeRefund } from "../lib/refund";
import {
  fromStripeMinorAmount,
  retrieveDispute,
  retrieveRefund,
  verifyStripeWebhook,
} from "../lib/stripe";
import type { Env, PaymentStatus } from "../lib/types";

type WorkerContext = Context<{ Bindings: Env }>;

const FULL_REFUND_REASON = "A Stripe visszaigazolta a megrendelés teljes visszatérítését.";

function enqueueRefundNotice(env: Env, orderId: string, reason = FULL_REFUND_REASON) {
  return enqueueEmail(env, {
    kind: "refund_notice",
    dedupeKey: `refund-notice:${orderId}`,
    orderId,
    payload: { reason },
  });
}

export async function handleCheckoutCompleted(c: WorkerContext, sessionId: string, eventId: string | null = null) {
  return completeCheckoutSession(c.env, sessionId, "webhook", eventId);
}

async function resolveOrderIdForPaymentIntent(
  env: Env,
  paymentIntent: { id?: string; metadata?: Record<string, string> },
) {
  if (paymentIntent.metadata?.orderId) return paymentIntent.metadata.orderId;
  if (!paymentIntent.id) return null;
  return (await getOrderByPaymentIntentId(env, paymentIntent.id))?.id ?? null;
}

async function handlePaymentFailure(
  env: Env,
  paymentIntent: { id?: string; metadata?: Record<string, string> },
) {
  const orderId = await resolveOrderIdForPaymentIntent(env, paymentIntent);
  if (!orderId) return;
  const changed = await markOrderPaymentStatus(env, orderId, "failed", { source: "webhook" });
  if (!changed) return;
  logEvent("payment_failed", { orderId });
  // A declined card can be retried in the same Checkout Session; the email is
  // delayed and skipped if the order is paid by then.
  await enqueueEmail(env, {
    kind: "payment_failed",
    dedupeKey: `payment-failed:${orderId}`,
    orderId,
    delayMs: 30 * 60_000,
  });
}

async function handleExpired(env: Env, object: {
  id?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
}) {
  const orderId = object.metadata?.orderId ?? object.client_reference_id;
  if (!orderId) return;
  const changed = await markOrderPaymentStatus(env, orderId, "expired", { source: "webhook" });
  if (!changed) return;
  logEvent("checkout_expired", { orderId });
  await enqueueEmail(env, { kind: "checkout_expired", dedupeKey: `checkout-expired:${orderId}`, orderId });
}

async function handleRefund(env: Env, charge: {
  id?: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string | null;
  refunded?: boolean;
  payment_intent?: string | null;
  metadata?: Record<string, string>;
  refunds?: { data?: Array<{ id?: string; amount?: number }> };
}) {
  let orderId = charge.metadata?.orderId ?? null;
  if (!orderId && charge.payment_intent) {
    orderId = (await getOrderByPaymentIntentId(env, charge.payment_intent))?.id ?? null;
  }
  if (!orderId || !charge.amount_refunded || charge.amount_refunded <= 0) return;
  const status: Extract<PaymentStatus, "partially_refunded" | "refunded"> =
    charge.refunded || (charge.amount && charge.amount_refunded >= charge.amount)
      ? "refunded"
      : "partially_refunded";
  const refundAmount = charge.currency
    ? fromStripeMinorAmount(charge.amount_refunded, charge.currency)
    : charge.amount_refunded;
  const refundStripeId = charge.refunds?.data?.find((refund) => refund.id)?.id ?? null;
  const changed = await markOrderPaymentStatus(env, orderId, status, {
    source: "webhook",
    refundAmount,
    refundStripeId,
  });
  if (!changed) return;
  logEvent(status, { orderId });
  if (status === "refunded") {
    const order = await getOrderById(env, orderId);
    await enqueueRefundNotice(env, orderId, REFUND_REASON_MESSAGES[order?.refund_reason ?? ""] ?? FULL_REFUND_REASON);
  }
}

async function handleRefundLifecycle(env: Env, object: { id?: string }, eventId: string) {
  if (!object.id?.startsWith("re_")) {
    logEvent("suspicious_payment_event", { reason: "invalid_refund_id" });
    return;
  }

  // Retrieve the authoritative current object so out-of-order webhook payloads
  // cannot regress a refund that Stripe has already settled.
  const refund = await retrieveRefund(env, object.id);
  let orderId = refund.metadata?.orderId ?? null;
  if (!orderId && refund.payment_intent) {
    orderId = (await getOrderByPaymentIntentId(env, refund.payment_intent))?.id ?? null;
  }
  if (!orderId) {
    logEvent("suspicious_payment_event", { reason: "unknown_refund_order" });
    return;
  }
  const order = await getOrderById(env, orderId);
  if (!order) {
    logEvent("suspicious_payment_event", { reason: "unknown_refund_order" });
    return;
  }

  const result = await reconcileStripeRefund(env, order, refund, "webhook", eventId);
  logEvent("refund_lifecycle_recorded", {
    orderId,
    refundStatus: result.status,
    paymentStatus: result.paymentStatus,
  });

  if (result.status === "succeeded" && result.paymentStatusChanged && result.paymentStatus === "refunded") {
    await enqueueRefundNotice(env, orderId, REFUND_REASON_MESSAGES[order.refund_reason ?? ""] ?? FULL_REFUND_REASON);
  } else if (result.status === "failed" || result.status === "canceled" || result.status === "requires_action") {
    logEvent("refund_manual_followup_required", { orderId, refundStatus: result.status });
  }
}

/**
 * Inquiries (`warning_*`) and prevented disputes move no money, so access stays
 * active. Only formal chargebacks change the order's payment state.
 */
export function paymentStatusForDispute(status: string): Extract<PaymentStatus, "chargeback_open" | "chargeback_lost" | "chargeback_won"> | null {
  if (status === "needs_response" || status === "under_review") return "chargeback_open";
  if (status === "won") return "chargeback_won";
  if (status === "lost") return "chargeback_lost";
  return null;
}

async function handleDispute(env: Env, object: { id?: string }, eventId: string) {
  if (!object.id) {
    logEvent("suspicious_payment_event", { reason: "missing_dispute_id" });
    return;
  }
  // Out-of-order deliveries are resolved by reading the current dispute.
  const dispute = await retrieveDispute(env, object.id);

  let orderId = dispute.metadata?.orderId ?? null;
  if (!orderId && dispute.payment_intent) {
    orderId = (await getOrderByPaymentIntentId(env, dispute.payment_intent))?.id ?? null;
  }
  if (!orderId) {
    logEvent("suspicious_payment_event", { reason: "unknown_dispute_order", disputeId: dispute.id });
    return;
  }

  const paymentStatus = paymentStatusForDispute(dispute.status);
  await upsertPaymentDispute(env, {
    id: crypto.randomUUID(),
    orderId,
    stripeDisputeId: dispute.id,
    stripeChargeId: dispute.charge ?? null,
    stripePaymentIntentId: dispute.payment_intent ?? null,
    amount: typeof dispute.amount === "number" && dispute.currency ? fromStripeMinorAmount(dispute.amount, dispute.currency) : null,
    currency: dispute.currency?.toLowerCase() ?? null,
    reason: dispute.reason ?? null,
    status: dispute.status,
    outcome: paymentStatus === "chargeback_open" ? null : paymentStatus,
    eventId,
  });

  const changed = paymentStatus
    ? await markOrderPaymentStatus(env, orderId, paymentStatus, { source: "webhook" })
    : false;
  logEvent("chargeback_dispute_recorded", {
    orderId,
    disputeId: dispute.id,
    disputeStatus: dispute.status,
    paymentStatus,
    changed,
  });
}

export async function stripeWebhookRoute(c: WorkerContext) {
  if (c.env.PAYMENTS_ENABLED !== "true") {
    return c.text("Payments disabled", 404);
  }

  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 256 * 1024) {
    logEvent("stripe_webhook_rejected", { reason: "body_too_large" });
    return c.text("Request too large", 413);
  }
  const event = await verifyStripeWebhook(
    rawBody,
    c.req.header("Stripe-Signature"),
    c.env.STRIPE_WEBHOOK_SECRET,
  );
  if (!event) {
    logEvent("stripe_webhook_signature_failed");
    return c.text("Invalid signature", 400);
  }

  const expectedLiveMode = c.env.PAYMENT_MODE === "live";
  if (event.livemode !== expectedLiveMode) {
    logEvent("stripe_webhook_mode_mismatch", {
      eventId: event.id,
      configuredMode: c.env.PAYMENT_MODE ?? "missing",
    });
    return c.text("Event mode mismatch", 400);
  }

  const object = event.data.object as { id?: string };
  const firstTime = await claimStripeEvent(c.env, event.id, event.type, object.id ?? "");
  if (!firstTime) {
    const eventStatus = await getProcessedStripeEventStatus(c.env, event.id);
    if (eventStatus === "completed") {
      logEvent("duplicate_webhook_ignored", { eventId: event.id, eventType: event.type });
      return c.text("Already processed", 200);
    }
    logEvent("duplicate_webhook_processing", {
      eventId: event.id,
      eventType: event.type,
      eventStatus: eventStatus ?? "unknown",
    });
    return c.text("Event processing", 409);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(c, object.id ?? "", event.id);
        break;
      case "checkout.session.async_payment_failed":
      case "payment_intent.payment_failed":
        await handlePaymentFailure(
          c.env,
          event.data.object as { id?: string; metadata?: Record<string, string> },
        );
        break;
      case "checkout.session.expired":
        await handleExpired(
          c.env,
          event.data.object as {
            id?: string;
            client_reference_id?: string | null;
            metadata?: Record<string, string>;
          },
        );
        break;
      case "charge.refunded":
        await handleRefund(c.env, event.data.object as Parameters<typeof handleRefund>[1]);
        break;
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
        await handleRefundLifecycle(c.env, object, event.id);
        break;
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
        await handleDispute(c.env, object, event.id);
        break;
      default:
        break;
    }
    await completeStripeEvent(c.env, event.id);
    return c.text("ok", 200);
  } catch (error) {
    const errorCode = error instanceof Error ? error.name : "WEBHOOK_PROCESSING_ERROR";
    await failStripeEvent(c.env, event.id, errorCode);
    logEvent("stripe_webhook_processing_failed", { eventId: event.id, eventType: event.type });
    return c.text("Webhook processing failed", 500);
  }
}
