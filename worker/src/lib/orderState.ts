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

/** Maximum number of user-initiated regenerations allowed per order (fallback). */
export const MAX_REGENERATIONS = 3;

/**
 * Returns true when the user is allowed to request another generation of
 * the same order. Conditions:
 *  - payment must be confirmed (paid)
 *  - the previous generation must have completed (not in-flight or failed)
 *  - the user has not yet exhausted the regeneration budget
 *
 * @param maxRegenerations Per-package limit; defaults to MAX_REGENERATIONS.
 */
export function canRequestRegeneration(
  order: Pick<OrderRow, "payment_status" | "ai_status" | "generation_count">,
  maxRegenerations = MAX_REGENERATIONS,
) {
  return (
    order.payment_status === "paid" &&
    order.ai_status === "completed" &&
    order.generation_count > 0 &&
    order.generation_count <= maxRegenerations
  );
}

export function isFinalAiStatus(status: AiStatus) {
  return status === "completed" || status === "failed" || status === "failed_review";
}
