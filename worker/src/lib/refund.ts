import { markOrderPaymentStatus, upsertPaymentRefund } from "./db";
import { fromStripeMinorAmount, normalizeStripeRefundStatus } from "./stripe";
import type { Env, OrderRow, OrderStatusChangeSource } from "./types";
import type { StripeRefund } from "./stripe";

export async function reconcileStripeRefund(
  env: Env,
  order: OrderRow,
  refund: StripeRefund,
  source: OrderStatusChangeSource,
  eventId?: string,
) {
  const status = normalizeStripeRefundStatus(refund.status);
  const amount = fromStripeMinorAmount(refund.amount, refund.currency);

  await upsertPaymentRefund(env, {
    id: crypto.randomUUID(),
    orderId: order.id,
    stripeRefundId: refund.id,
    stripePaymentIntentId: refund.payment_intent ?? order.stripe_payment_intent_id,
    amount,
    currency: refund.currency.toLowerCase(),
    status,
    failureReason: refund.failure_reason ?? null,
    eventId: eventId ?? null,
  });

  if (status !== "succeeded") {
    return { status, amount, paymentStatus: null, paymentStatusChanged: false } as const;
  }

  const originallyPaid = order.paid_amount ?? order.server_calculated_price;
  const paymentStatus = amount !== null && amount >= originallyPaid
    ? "refunded"
    : "partially_refunded";
  const paymentStatusChanged = await markOrderPaymentStatus(env, order.id, paymentStatus, {
    source,
    refundAmount: amount,
    refundStripeId: refund.id,
  });

  return { status, amount, paymentStatus, paymentStatusChanged } as const;
}
