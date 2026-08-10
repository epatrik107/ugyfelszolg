import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, OrderRow } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  beginGeneration: vi.fn(),
  claimStripeEvent: vi.fn(),
  completeStripeEvent: vi.fn(),
  failStripeEvent: vi.fn(),
  getOrderById: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
  getProcessedStripeEventStatus: vi.fn(),
  markOrderPaid: vi.fn(),
  markOrderPaymentStatus: vi.fn(),
  upsertPaymentDispute: vi.fn(),
  upsertPaymentRefund: vi.fn(),
  markRefundInvoiceManualRequired: vi.fn(),
  generateLetterForPaidOrder: vi.fn(),
  processInvoiceForOrder: vi.fn(),
  fromStripeMinorAmount: vi.fn((amount: number | null, currency: string | null) => {
    if (amount === null || currency === null) return null;
    return currency.toLowerCase() === "huf" ? amount / 100 : amount;
  }),
  retrieveCheckoutSession: vi.fn(),
  retrieveRefund: vi.fn(),
  verifyStripeWebhook: vi.fn(),
  sendCheckoutExpiredEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
  sendRefundEmail: vi.fn(),
  getInvoiceByOrderId: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  beginGeneration: mocks.beginGeneration,
  claimStripeEvent: mocks.claimStripeEvent,
  completeStripeEvent: mocks.completeStripeEvent,
  failStripeEvent: mocks.failStripeEvent,
  getOrderById: mocks.getOrderById,
  getOrderByPaymentIntentId: mocks.getOrderByPaymentIntentId,
  getProcessedStripeEventStatus: mocks.getProcessedStripeEventStatus,
  markOrderPaid: mocks.markOrderPaid,
  markOrderPaymentStatus: mocks.markOrderPaymentStatus,
  upsertPaymentDispute: mocks.upsertPaymentDispute,
  upsertPaymentRefund: mocks.upsertPaymentRefund,
  markRefundInvoiceManualRequired: mocks.markRefundInvoiceManualRequired,
}));
vi.mock("../src/lib/ai", () => ({
  generateLetterForPaidOrder: mocks.generateLetterForPaidOrder,
}));
vi.mock("../src/lib/invoice", () => ({
  processInvoiceForOrder: mocks.processInvoiceForOrder,
  getInvoiceByOrderId: mocks.getInvoiceByOrderId,
}));
vi.mock("../src/lib/stripe", () => ({
  fromStripeMinorAmount: mocks.fromStripeMinorAmount,
  retrieveCheckoutSession: mocks.retrieveCheckoutSession,
  retrieveRefund: mocks.retrieveRefund,
  normalizeStripeRefundStatus: (status: string) => status,
  verifyStripeWebhook: mocks.verifyStripeWebhook,
}));
vi.mock("../src/lib/email", () => ({
  sendCheckoutExpiredEmail: mocks.sendCheckoutExpiredEmail,
  sendPaymentFailedEmail: mocks.sendPaymentFailedEmail,
  sendRefundEmail: mocks.sendRefundEmail,
}));

const { stripeWebhookRoute } = await import("../src/routes/stripeWebhook");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/webhook", stripeWebhookRoute);
  return instance;
}

function event(type: string, object: Record<string, unknown>, id = "evt_1") {
  return { id, type, livemode: false, data: { object } };
}

async function deliver(waitUntilPromises: Promise<unknown>[]) {
  const response = await app().fetch(
    new Request("https://worker.test/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": "test" },
      body: "{}",
    }),
    {
      PAYMENTS_ENABLED: "true",
      PAYMENT_MODE: "test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    } as Env,
    {
      waitUntil(promise: Promise<unknown>) {
        waitUntilPromises.push(promise);
      },
    } as unknown as ExecutionContext,
  );
  await Promise.all(waitUntilPromises);
  return response;
}

describe("Stripe webhook business flow", () => {
  let currentOrder: OrderRow;

  beforeEach(() => {
    vi.clearAllMocks();
    currentOrder = orderFixture();
    mocks.claimStripeEvent.mockResolvedValue(true);
    mocks.completeStripeEvent.mockResolvedValue(undefined);
    mocks.failStripeEvent.mockResolvedValue(undefined);
    mocks.getProcessedStripeEventStatus.mockResolvedValue("completed");
    mocks.getOrderById.mockImplementation(async () => currentOrder);
    mocks.getOrderByPaymentIntentId.mockResolvedValue(null);
    mocks.markOrderPaid.mockImplementation(async () => {
      if (!["pending", "checkout_created", "failed"].includes(currentOrder.payment_status)) return false;
      currentOrder = {
        ...currentOrder,
        payment_status: "paid",
        paid_at: "2026-06-22T10:01:00.000Z",
        stripe_payment_intent_id: "pi_test_1",
        invoice_status: "pending",
      };
      return true;
    });
    mocks.markOrderPaymentStatus.mockResolvedValue(true);
    mocks.upsertPaymentDispute.mockResolvedValue(undefined);
    mocks.upsertPaymentRefund.mockResolvedValue(undefined);
    mocks.getInvoiceByOrderId.mockResolvedValue({ invoice_number: "INV-1" });
    mocks.sendRefundEmail.mockResolvedValue(undefined);
    mocks.retrieveRefund.mockResolvedValue({
      id: "re_1",
      payment_intent: "pi_test_1",
      amount: 89000,
      currency: "huf",
      status: "succeeded",
    });
    mocks.beginGeneration.mockImplementation(async () => {
      if (currentOrder.payment_status !== "paid" || currentOrder.ai_status !== "not_started") return false;
      currentOrder = { ...currentOrder, ai_status: "generating", generation_count: 1 };
      return true;
    });
    mocks.generateLetterForPaidOrder.mockResolvedValue(undefined);
    mocks.processInvoiceForOrder.mockResolvedValue("created");
    mocks.retrieveCheckoutSession.mockResolvedValue({
      id: "cs_test_1",
      url: null,
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: 89000,
      currency: "huf",
      customer: null,
      payment_intent: "pi_test_1",
      subscription: null,
      client_reference_id: "order_1",
      metadata: {
        orderId: "order_1",
        publicId: "public_1",
        selectedPackage: "basic",
      },
    });
    mocks.verifyStripeWebhook.mockResolvedValue(
      event("checkout.session.completed", { id: "cs_test_1" }),
    );
  });

  it("marks paid, activates once, and starts invoicing after a verified exact payment", async () => {
    const response = await deliver([]);
    expect(response.status).toBe(200);
    expect(mocks.markOrderPaid).toHaveBeenCalledOnce();
    expect(mocks.beginGeneration).toHaveBeenCalledOnce();
    expect(mocks.generateLetterForPaidOrder).toHaveBeenCalledOnce();
    expect(mocks.processInvoiceForOrder).toHaveBeenCalledWith(expect.anything(), "order_1");
    expect(mocks.completeStripeEvent).toHaveBeenCalledWith(expect.anything(), "evt_1");
  });

  it("keeps the order paid and activated when invoicing requires retry", async () => {
    mocks.processInvoiceForOrder.mockResolvedValue("retry_required");
    const response = await deliver([]);
    expect(response.status).toBe(200);
    expect(currentOrder.payment_status).toBe("paid");
    expect(mocks.generateLetterForPaidOrder).toHaveBeenCalledOnce();
  });

  it("detects amount mismatch and creates neither access nor invoice", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValueOnce({
      ...(await mocks.retrieveCheckoutSession()),
      amount_total: 1,
    });
    await deliver([]);
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "amount_mismatch",
      { source: "webhook" },
    );
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.beginGeneration).not.toHaveBeenCalled();
    expect(mocks.processInvoiceForOrder).not.toHaveBeenCalled();
  });

  it("detects currency mismatch and creates neither access nor invoice", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValueOnce({
      ...(await mocks.retrieveCheckoutSession()),
      currency: "eur",
    });
    await deliver([]);
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "currency_mismatch",
      { source: "webhook" },
    );
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.processInvoiceForOrder).not.toHaveBeenCalled();
  });

  it("rejects a Stripe customer email mismatch before fulfillment or invoicing", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValueOnce({
      ...(await mocks.retrieveCheckoutSession()),
      customer_details: { email: "attacker@example.com" },
    });
    await deliver([]);
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.beginGeneration).not.toHaveBeenCalled();
    expect(mocks.processInvoiceForOrder).not.toHaveBeenCalled();
  });

  it("ignores a duplicate event id before any payment side effect", async () => {
    mocks.claimStripeEvent.mockResolvedValueOnce(false);
    const response = await deliver([]);
    expect(response.status).toBe(200);
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.processInvoiceForOrder).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when a duplicate event is still processing", async () => {
    mocks.claimStripeEvent.mockResolvedValueOnce(false);
    mocks.getProcessedStripeEventStatus.mockResolvedValueOnce("processing");
    const response = await deliver([]);
    expect(response.status).toBe(409);
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.completeStripeEvent).not.toHaveBeenCalled();
  });

  it("does not double-pay or double-activate for a second event on the same order", async () => {
    await deliver([]);
    mocks.verifyStripeWebhook.mockResolvedValue(
      event("checkout.session.async_payment_succeeded", { id: "cs_test_1" }, "evt_2"),
    );
    await deliver([]);
    expect(mocks.markOrderPaid).toHaveBeenCalledOnce();
    expect(mocks.generateLetterForPaidOrder).toHaveBeenCalledOnce();
  });

  it.each([
    ["payment_intent.payment_failed", { id: "pi_test_1", metadata: { orderId: "order_1" } }, "failed"],
    ["checkout.session.async_payment_failed", { id: "pi_test_1", metadata: { orderId: "order_1" } }, "failed"],
    ["checkout.session.expired", { id: "cs_test_1", metadata: { orderId: "order_1" } }, "expired"],
  ])("handles %s without activation or invoicing", async (type, object, status) => {
    mocks.verifyStripeWebhook.mockResolvedValue(event(type, object));
    await deliver([]);
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      status,
      { source: "webhook" },
    );
    expect(mocks.beginGeneration).not.toHaveBeenCalled();
    expect(mocks.processInvoiceForOrder).not.toHaveBeenCalled();
  });

  it.each([
    [200, 100, false, "partially_refunded"],
    [200, 200, true, "refunded"],
  ])("tracks refund amount and requires manual invoice correction", async (amount, refundedAmount, refunded, status) => {
    currentOrder = orderFixture({ payment_status: "paid", stripe_payment_intent_id: "pi_test_1" });
    mocks.verifyStripeWebhook.mockResolvedValue(
      event("charge.refunded", {
        id: "ch_1",
        amount,
        amount_refunded: refundedAmount,
        refunded,
        payment_intent: "pi_test_1",
        metadata: { orderId: "order_1" },
      }),
    );
    await deliver([]);
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      status,
      {
        source: "webhook",
        refundAmount: refundedAmount,
        refundStripeId: null,
      },
    );
    expect(mocks.markRefundInvoiceManualRequired).not.toHaveBeenCalled();
  });

  it.each(["pending", "requires_action", "failed", "canceled"])(
    "records a %s refund without falsely settling or emailing it",
    async (refundStatus) => {
      currentOrder = orderFixture({
        payment_status: "paid",
        stripe_payment_intent_id: "pi_test_1",
        paid_amount: 890,
      });
      mocks.getOrderByPaymentIntentId.mockResolvedValueOnce(currentOrder);
      mocks.retrieveRefund.mockResolvedValueOnce({
        id: "re_1",
        payment_intent: "pi_test_1",
        amount: 89000,
        currency: "huf",
        status: refundStatus,
        failure_reason: refundStatus === "failed" ? "expired_or_canceled_card" : null,
      });
      mocks.verifyStripeWebhook.mockResolvedValue(event("refund.updated", { id: "re_1" }));

      const response = await deliver([]);

      expect(response.status).toBe(200);
      expect(mocks.upsertPaymentRefund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orderId: "order_1", status: refundStatus }),
      );
      expect(mocks.markOrderPaymentStatus).not.toHaveBeenCalledWith(
        expect.anything(),
        "order_1",
        "refunded",
        expect.anything(),
      );
      expect(mocks.sendRefundEmail).not.toHaveBeenCalled();
    },
  );

  it("settles and emails only an authoritative succeeded refund", async () => {
    currentOrder = orderFixture({
      payment_status: "paid",
      stripe_payment_intent_id: "pi_test_1",
      paid_amount: 890,
    });
    mocks.getOrderByPaymentIntentId.mockResolvedValueOnce(currentOrder);
    mocks.verifyStripeWebhook.mockResolvedValue(event("refund.updated", { id: "re_1" }));

    const response = await deliver([]);

    expect(response.status).toBe(200);
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "refunded",
      { source: "webhook", refundAmount: 890, refundStripeId: "re_1" },
    );
    expect(mocks.sendRefundEmail).toHaveBeenCalledOnce();
  });

  it("records a chargeback dispute and revokes active access without fulfillment side effects", async () => {
    currentOrder = orderFixture({
      payment_status: "paid",
      stripe_payment_intent_id: "pi_test_1",
      ai_status: "completed",
      generated_letter: "Kész levél.",
    });
    mocks.getOrderByPaymentIntentId.mockResolvedValueOnce(currentOrder);
    mocks.verifyStripeWebhook.mockResolvedValue(
      event("charge.dispute.created", {
        id: "dp_1",
        charge: "ch_1",
        payment_intent: "pi_test_1",
        amount: 89000,
        currency: "huf",
        reason: "fraudulent",
        status: "needs_response",
      }),
    );

    const response = await deliver([]);
    expect(response.status).toBe(200);
    expect(mocks.upsertPaymentDispute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderId: "order_1",
        stripeDisputeId: "dp_1",
        stripePaymentIntentId: "pi_test_1",
        amount: 890,
        currency: "huf",
        status: "needs_response",
      }),
    );
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "chargeback_open",
      { source: "webhook" },
    );
    expect(mocks.beginGeneration).not.toHaveBeenCalled();
    expect(mocks.processInvoiceForOrder).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without claiming the event", async () => {
    mocks.verifyStripeWebhook.mockResolvedValue(null);
    const response = await deliver([]);
    expect(response.status).toBe(400);
    expect(mocks.claimStripeEvent).not.toHaveBeenCalled();
  });

  it("rejects a live event in test mode before claiming it", async () => {
    mocks.verifyStripeWebhook.mockResolvedValue({
      ...event("checkout.session.completed", { id: "cs_live_1" }),
      livemode: true,
    });
    const response = await deliver([]);
    expect(response.status).toBe(400);
    expect(mocks.claimStripeEvent).not.toHaveBeenCalled();
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 500 and marks the event retryable when critical processing throws", async () => {
    mocks.retrieveCheckoutSession.mockRejectedValueOnce(new Error("temporary Stripe failure"));
    const response = await deliver([]);
    expect(response.status).toBe(500);
    expect(mocks.failStripeEvent).toHaveBeenCalledWith(expect.anything(), "evt_1", "Error");
    expect(mocks.completeStripeEvent).not.toHaveBeenCalled();
  });
});
