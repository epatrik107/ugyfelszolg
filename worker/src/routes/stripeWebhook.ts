import type { Context } from "hono";
import {
  beginGeneration,
  claimStripeEvent,
  getOrderById,
  markOrderPaid,
  markOrderPaymentStatus,
} from "../lib/db";
import { sendCheckoutExpiredEmail, sendInvoiceEmail, sendPaymentFailedEmail } from "../lib/email";
import { createInvoice } from "../lib/invoice";
import { logEvent } from "../lib/logger";
import { generateLetterForPaidOrder } from "../lib/ai";
import { canStartGeneration } from "../lib/orderState";
import { getPackage } from "../lib/packages";
import {
  retrieveCheckoutSession,
  verifyStripeWebhook,
} from "../lib/stripe";
import type { Env } from "../lib/types";

async function handleCheckoutCompleted(
  c: Context<{ Bindings: Env }>,
  sessionId: string,
) {
  const session = await retrieveCheckoutSession(c.env, sessionId);
  const orderId = session.metadata.orderId;
  const packageId = session.metadata.selectedPackage as
    | "basic"
    | "premium"
    | "premium_plus"
    | undefined;
  if (!orderId || !packageId) {
    return;
  }

  const order = await getOrderById(c.env, orderId);
  if (!order || order.payment_status !== "pending") {
    return;
  }

  const selectedPackage = getPackage(packageId);
  if (
    session.payment_status !== "paid" ||
    session.amount_total !== selectedPackage.price ||
    session.currency !== selectedPackage.currency
  ) {
    return;
  }

  await markOrderPaid(c.env, order.id, {
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
  });
  logEvent("payment_paid", { orderId: order.id, stripeSessionId: session.id });

  // Issue invoice and send it by email (non-fatal – errors are logged but don't block generation)
  const paidOrder = await getOrderById(c.env, order.id);
  if (paidOrder && c.env.RESEND_API_KEY) {
    try {
      const invoice = await createInvoice(c.env, paidOrder);
      logEvent("invoice_created", { orderId: paidOrder.id, invoiceNumber: invoice.invoice_number });
      await sendInvoiceEmail(c.env, paidOrder, invoice);
      logEvent("invoice_email_sent", { orderId: paidOrder.id });
    } catch (invoiceError) {
      logEvent("invoice_error", {
        orderId: paidOrder.id,
        reason: invoiceError instanceof Error ? invoiceError.message : "unknown",
      });
    }
  }

  if (paidOrder && canStartGeneration(paidOrder) && (await beginGeneration(c.env, paidOrder.id))) {
    c.executionCtx.waitUntil(generateLetterForPaidOrder(c.env, paidOrder));
  }
}

export async function stripeWebhookRoute(c: Context<{ Bindings: Env }>) {
  if (c.env.PAYMENTS_ENABLED !== "true") {
    return c.text("Payments disabled", 404);
  }

  const rawBody = await c.req.text();
  const event = await verifyStripeWebhook(
    rawBody,
    c.req.header("Stripe-Signature"),
    c.env.STRIPE_WEBHOOK_SECRET,
  );

  if (!event) {
    logEvent("stripe_webhook_signature_failed");
    return c.text("Invalid signature", 400);
  }

  logEvent("stripe_webhook_signature_verified", { eventId: event.id });
  logEvent("stripe_webhook_received", { eventId: event.id, eventType: event.type });
  const firstTime = await claimStripeEvent(c.env, event.id, event.type);
  if (!firstTime) {
    return c.text("Already processed", 200);
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(c, (event.data.object as { id: string }).id);
      break;
    case "checkout.session.expired": {
      const object = event.data.object as { metadata?: Record<string, string> };
      if (object.metadata?.orderId) {
        await markOrderPaymentStatus(c.env, object.metadata.orderId, "expired");
        if (c.env.RESEND_API_KEY) {
          try {
            const expiredOrder = await getOrderById(c.env, object.metadata.orderId);
            if (expiredOrder) {
              await sendCheckoutExpiredEmail(c.env, expiredOrder);
            }
          } catch {
            // non-fatal
          }
        }
      }
      break;
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as { metadata?: Record<string, string> };
      if (paymentIntent.metadata?.orderId) {
        await markOrderPaymentStatus(c.env, paymentIntent.metadata.orderId, "failed");
        // Notify customer so they can retry with a different card
        if (c.env.RESEND_API_KEY) {
          try {
            const failedOrder = await getOrderById(c.env, paymentIntent.metadata.orderId);
            if (failedOrder) {
              await sendPaymentFailedEmail(c.env, failedOrder);
            }
          } catch {
            // non-fatal
          }
        }
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as { metadata?: Record<string, string> };
      if (charge.metadata?.orderId) {
        await markOrderPaymentStatus(c.env, charge.metadata.orderId, "refunded");
      }
      break;
    }
    default:
      break;
  }

  return c.text("ok", 200);
}
