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
  markOrderPaid: vi.fn(),
  markOrderPaymentStatus: vi.fn(),
  markRefundInvoiceManualRequired: vi.fn(),
  generateLetterForPaidOrder: vi.fn(),
  processInvoiceForOrder: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  verifyStripeWebhook: vi.fn(),
  sendCheckoutExpiredEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  beginGeneration: mocks.beginGeneration,
  claimStripeEvent: mocks.claimStripeEvent,
  completeStripeEvent: mocks.completeStripeEvent,
  failStripeEvent: mocks.failStripeEvent,
  getOrderById: mocks.getOrderById,
  getOrderByPaymentIntentId: mocks.getOrderByPaymentIntentId,
  markOrderPaid: mocks.markOrderPaid,
  markOrderPaymentStatus: mocks.markOrderPaymentStatus,
  markRefundInvoiceManualRequired: mocks.markRefundInvoiceManualRequired,
}));
vi.mock("../src/lib/ai", () => ({
  generateLetterForPaidOrder: mocks.generateLetterForPaidOrder,
}));
vi.mock("../src/lib/invoice", () => ({
  processInvoiceForOrder: mocks.processInvoiceForOrder,
}));
vi.mock("../src/lib/stripe", () => ({
  retrieveCheckoutSession: mocks.retrieveCheckoutSession,
  verifyStripeWebhook: mocks.verifyStripeWebhook,
}));
vi.mock("../src/lib/email", () => ({
  sendCheckoutExpiredEmail: mocks.sendCheckoutExpiredEmail,
  sendPaymentFailedEmail: mocks.sendPaymentFailedEmail,
}));

const { stripeWebhookRoute } = await import("../src/routes/stripeWebhook");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/webhook", stripeWebhookRoute);
  return instance;
}

function event(type: string, object: Record<string, unknown>, id = "evt_1") {
  return { id, type, data: { object } };
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
      amount_total: 890,
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
    );
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
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
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(expect.anything(), "order_1", status);
    expect(mocks.markRefundInvoiceManualRequired).toHaveBeenCalledWith(expect.anything(), "order_1");
  });

  it("rejects an invalid signature without claiming the event", async () => {
    mocks.verifyStripeWebhook.mockResolvedValue(null);
    const response = await deliver([]);
    expect(response.status).toBe(400);
    expect(mocks.claimStripeEvent).not.toHaveBeenCalled();
  });

  it("returns 500 and marks the event retryable when critical processing throws", async () => {
    mocks.retrieveCheckoutSession.mockRejectedValueOnce(new Error("temporary Stripe failure"));
    const response = await deliver([]);
    expect(response.status).toBe(500);
    expect(mocks.failStripeEvent).toHaveBeenCalledWith(expect.anything(), "evt_1", "Error");
    expect(mocks.completeStripeEvent).not.toHaveBeenCalled();
  });
});
