import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  cleanupExpiredData: vi.fn(),
  failGeneration: vi.fn(),
  getStuckGeneratingOrders: vi.fn(),
  markOrderPaymentStatus: vi.fn(),
  retryDueInvoices: vi.fn(),
  getInvoiceByOrderId: vi.fn(),
  createRefund: vi.fn(),
  sendRefundEmail: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  cleanupExpiredData: mocks.cleanupExpiredData,
  failGeneration: mocks.failGeneration,
  getStuckGeneratingOrders: mocks.getStuckGeneratingOrders,
  markOrderPaymentStatus: mocks.markOrderPaymentStatus,
}));

vi.mock("../src/lib/invoice", () => ({
  retryDueInvoices: mocks.retryDueInvoices,
  getInvoiceByOrderId: mocks.getInvoiceByOrderId,
}));

vi.mock("../src/lib/stripe", () => ({
  createRefund: mocks.createRefund,
  fromStripeMinorAmount: (amount: number, currency: string) =>
    currency.toLowerCase() === "huf" ? amount / 100 : amount,
}));

vi.mock("../src/lib/email", () => ({
  sendRefundEmail: mocks.sendRefundEmail,
}));

const app = (await import("../src/index")).default;

function env(): Env {
  return {
    GEMINI_API_KEY: "gemini-key",
    TOKEN_HASH_SECRET: "token-secret-with-at-least-32-chars",
    SITE_URL: "https://example.com",
    ALLOWED_ORIGINS: "https://example.com",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    DEMO_MODE: "false",
    PAYMENTS_ENABLED: "false",
    DB: {} as D1Database,
    RATE_LIMIT_KV: {} as KVNamespace,
  } as Env;
}

describe("scheduled cron jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.failGeneration.mockResolvedValue(true);
    mocks.retryDueInvoices.mockResolvedValue([{ orderId: "order_invoice", status: "created" }]);
    mocks.getStuckGeneratingOrders.mockResolvedValue([]);
    mocks.createRefund.mockResolvedValue({ id: "re_1", amount: 89000, currency: "huf", status: "succeeded" });
    mocks.getInvoiceByOrderId.mockResolvedValue({ invoice_number: "INV-1" });
  });

  it("runs cleanup, invoice retries, and resolves stuck checkout orders with refund metadata", async () => {
    mocks.getStuckGeneratingOrders.mockResolvedValue([
      orderFixture({
        ai_status: "generating",
        payment_status: "paid",
        stripe_payment_intent_id: "pi_1",
        billing_source: "checkout",
        server_calculated_price: 890,
      }),
    ]);

    await app.scheduled({} as ScheduledController, env());

    expect(mocks.cleanupExpiredData).toHaveBeenCalledWith(expect.anything());
    expect(mocks.retryDueInvoices).toHaveBeenCalledWith(expect.anything());
    expect(mocks.failGeneration).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "failed",
      "Automatikusan lezárva: generálás időtúllépés.",
      null,
    );
    expect(mocks.createRefund).toHaveBeenCalledWith(expect.anything(), "pi_1");
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "refunded",
      { source: "cron", refundAmount: 890, refundStripeId: "re_1" },
    );
    expect(mocks.sendRefundEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "order_1" }),
      "INV-1",
      expect.stringContaining("technikai hiba"),
    );
  });

  it("does not refund subscription stuck orders", async () => {
    mocks.getStuckGeneratingOrders.mockResolvedValue([
      orderFixture({
        ai_status: "generating",
        payment_status: "paid",
        subscription_id: "sub_1",
        billing_source: "subscription",
        stripe_payment_intent_id: null,
      }),
    ]);

    await app.scheduled({} as ScheduledController, env());

    expect(mocks.failGeneration).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "failed",
      "Automatikusan lezárva: generálás időtúllépés.",
      "sub_1",
    );
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("does not refund when a stuck order state changed before cron could fail it", async () => {
    mocks.failGeneration.mockResolvedValueOnce(false);
    mocks.getStuckGeneratingOrders.mockResolvedValue([
      orderFixture({
        ai_status: "generating",
        payment_status: "paid",
        stripe_payment_intent_id: "pi_1",
        billing_source: "checkout",
      }),
    ]);

    await app.scheduled({} as ScheduledController, env());

    expect(mocks.failGeneration).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "failed",
      "Automatikusan lezárva: generálás időtúllépés.",
      null,
    );
    expect(mocks.createRefund).not.toHaveBeenCalled();
    expect(mocks.markOrderPaymentStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "refunded",
      expect.anything(),
    );
    expect(mocks.sendRefundEmail).not.toHaveBeenCalled();
  });
});
