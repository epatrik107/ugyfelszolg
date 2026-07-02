import type { Context } from "hono";
import {
  beginGeneration,
  claimStripeEvent,
  completeStripeEvent,
  failStripeEvent,
  getOrderById,
  getOrderByPaymentIntentId,
  markOrderPaid,
  markOrderPaymentStatus,
} from "../lib/db";
import { sendCheckoutExpiredEmail, sendPaymentFailedEmail } from "../lib/email";
import { generateLetterForPaidOrder } from "../lib/ai";
import { processInvoiceForOrder } from "../lib/invoice";
import { logEvent } from "../lib/logger";
import {
  fromStripeMinorAmount,
  retrieveCheckoutSession,
  verifyStripeWebhook,
} from "../lib/stripe";
import type { Env, OrderRow, PaymentStatus } from "../lib/types";

type WorkerContext = Context<{ Bindings: Env }>;

function runLater(c: WorkerContext, promise: Promise<unknown>, event: string, orderId: string) {
  c.executionCtx.waitUntil(
    promise.catch((error) => {
      logEvent(event, {
        orderId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }),
  );
}

function schedulePaidOrderSideEffects(c: WorkerContext, order: OrderRow) {
  runLater(
    c,
    processInvoiceForOrder(c.env, order.id).then((status) => {
      logEvent(status === "created" || status === "already_created" ? "invoice_created" : "invoice_pending", {
        orderId: order.id,
        invoiceStatus: status,
      });
    }),
    "invoice_processing_error",
    order.id,
  );
}

export async function handleCheckoutCompleted(c: WorkerContext, sessionId: string) {
  const session = await retrieveCheckoutSession(c.env, sessionId);
  const orderId = session.metadata.orderId;
  if (!orderId) {
    logEvent("suspicious_payment_event", { reason: "missing_order_metadata" });
    return;
  }

  let order = await getOrderById(c.env, orderId);
  if (!order) {
    logEvent("suspicious_payment_event", { reason: "unknown_order" });
    return;
  }

  if (order.payment_status === "paid") {
    schedulePaidOrderSideEffects(c, order);
    const recoveredActivation = await beginGeneration(c.env, order.id);
    if (recoveredActivation) {
      const generatingOrder = (await getOrderById(c.env, order.id)) ?? order;
      runLater(
        c,
        generateLetterForPaidOrder(c.env, generatingOrder),
        "paid_order_activation_error",
        order.id,
      );
    }
    return;
  }
  if (["cancelled", "expired", "refunded", "partially_refunded"].includes(order.payment_status)) {
    logEvent("suspicious_payment_event", { orderId, reason: "terminal_order_state" });
    return;
  }

  if (
    session.mode !== "payment" ||
    (session.client_reference_id && session.client_reference_id !== order.id) ||
    session.metadata.selectedPackage !== order.selected_package ||
    (order.stripe_session_id && order.stripe_session_id !== session.id)
  ) {
    logEvent("suspicious_payment_event", { orderId, reason: "checkout_identity_mismatch" });
    return;
  }

  if (session.payment_status !== "paid") {
    logEvent("payment_not_settled", { orderId });
    return;
  }
  if (session.currency?.toLowerCase() !== order.currency.toLowerCase()) {
    await markOrderPaymentStatus(c.env, order.id, "currency_mismatch", { source: "webhook" });
    logEvent("currency_mismatch", { orderId });
    return;
  }
  const paidAmount = fromStripeMinorAmount(session.amount_total, session.currency);
  if (paidAmount !== order.server_calculated_price) {
    await markOrderPaymentStatus(c.env, order.id, "amount_mismatch", { source: "webhook" });
    logEvent("amount_mismatch", { orderId });
    return;
  }

  const changed = await markOrderPaid(c.env, order.id, {
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
    source: "webhook",
  });
  order = (await getOrderById(c.env, order.id)) ?? order;
  if (changed) {
    logEvent("payment_paid", { orderId: order.id, stripeSessionId: session.id });
  }

  if (order.payment_status !== "paid") return;
  schedulePaidOrderSideEffects(c, order);

  const started = await beginGeneration(c.env, order.id);
  if (started) {
    const generatingOrder = (await getOrderById(c.env, order.id)) ?? order;
    runLater(
      c,
      generateLetterForPaidOrder(c.env, generatingOrder),
      "paid_order_activation_error",
      order.id,
    );
  }
}

async function resolveOrderIdForPaymentIntent(
  c: WorkerContext,
  paymentIntent: { id?: string; metadata?: Record<string, string> },
) {
  if (paymentIntent.metadata?.orderId) return paymentIntent.metadata.orderId;
  if (!paymentIntent.id) return null;
  return (await getOrderByPaymentIntentId(c.env, paymentIntent.id))?.id ?? null;
}

async function handlePaymentFailure(
  c: WorkerContext,
  paymentIntent: { id?: string; metadata?: Record<string, string> },
) {
  const orderId = await resolveOrderIdForPaymentIntent(c, paymentIntent);
  if (!orderId) return;
  const changed = await markOrderPaymentStatus(c.env, orderId, "failed", { source: "webhook" });
  if (!changed) return;
  logEvent("payment_failed", { orderId });
  if (c.env.RESEND_API_KEY) {
    const order = await getOrderById(c.env, orderId);
    if (order) {
      runLater(c, sendPaymentFailedEmail(c.env, order), "payment_failed_email_error", orderId);
    }
  }
}

async function handleExpired(c: WorkerContext, object: {
  id?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
}) {
  const orderId = object.metadata?.orderId ?? object.client_reference_id;
  if (!orderId) return;
  const changed = await markOrderPaymentStatus(c.env, orderId, "expired", { source: "webhook" });
  if (!changed) return;
  logEvent("checkout_expired", { orderId });
  if (c.env.RESEND_API_KEY) {
    const order = await getOrderById(c.env, orderId);
    if (order) {
      runLater(c, sendCheckoutExpiredEmail(c.env, order), "checkout_expired_email_error", orderId);
    }
  }
}

async function handleRefund(c: WorkerContext, charge: {
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
    orderId = (await getOrderByPaymentIntentId(c.env, charge.payment_intent))?.id ?? null;
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
  const changed = await markOrderPaymentStatus(c.env, orderId, status, {
    source: "webhook",
    refundAmount,
    refundStripeId,
  });
  if (!changed) return;
  logEvent(status, { orderId });
  logEvent("refund_invoice_manual_required", { orderId, refundType: status });
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
    logEvent("duplicate_webhook_ignored", { eventId: event.id, eventType: event.type });
    return c.text("Already processed", 200);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(c, object.id ?? "");
        break;
      case "checkout.session.async_payment_failed":
      case "payment_intent.payment_failed":
        await handlePaymentFailure(
          c,
          event.data.object as { id?: string; metadata?: Record<string, string> },
        );
        break;
      case "checkout.session.expired":
        await handleExpired(
          c,
          event.data.object as {
            id?: string;
            client_reference_id?: string | null;
            metadata?: Record<string, string>;
          },
        );
        break;
      case "charge.refunded":
        await handleRefund(
          c,
          event.data.object as {
            id?: string;
            amount?: number;
            amount_refunded?: number;
            currency?: string | null;
            refunded?: boolean;
            payment_intent?: string | null;
            metadata?: Record<string, string>;
            refunds?: { data?: Array<{ id?: string; amount?: number }> };
          },
        );
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
