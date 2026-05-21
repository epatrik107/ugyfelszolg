import type { AiStatus, OrderRow, PaymentStatus } from "./types";

const paymentTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["paid", "failed", "expired"],
  paid: ["refunded"],
  failed: [],
  expired: [],
  refunded: [],
};

export function canTransitionPaymentStatus(
  from: PaymentStatus,
  to: PaymentStatus,
) {
  return from === to || paymentTransitions[from].includes(to);
}

export function canStartGeneration(order: Pick<OrderRow, "payment_status" | "ai_status" | "generation_count">) {
  return (
    order.payment_status === "paid" &&
    order.ai_status === "not_started" &&
    order.generation_count === 0
  );
}

export function isFinalAiStatus(status: AiStatus) {
  return status === "completed" || status === "failed" || status === "failed_review";
}
