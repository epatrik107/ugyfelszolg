import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, InvoiceRow } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  getOrderByPublicId: vi.fn(),
  getInvoiceByOrderId: vi.fn(),
  retryInvoiceForOrder: vi.fn(),
  retryInvoiceEmailForOrder: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getOrderByPublicId: mocks.getOrderByPublicId,
}));

vi.mock("../src/lib/invoice", () => ({
  getInvoiceByOrderId: mocks.getInvoiceByOrderId,
  retryInvoiceForOrder: mocks.retryInvoiceForOrder,
  retryInvoiceEmailForOrder: mocks.retryInvoiceEmailForOrder,
}));

const {
  adminInvoiceStatusRoute,
  adminRetryInvoiceEmailRoute,
  adminRetryInvoiceRoute,
} = await import("../src/routes/adminInvoice");

const ADMIN_TOKEN = "admin-token-with-at-least-thirty-two-chars";

function invoiceFixture(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "invoice_1",
    order_id: "order_1",
    invoice_number: "E-TST-2026-1",
    amount: 890,
    currency: "huf",
    customer_name: "Teszt Elek",
    customer_email: "szamla@example.com",
    issued_at: "2026-06-22T10:01:00.000Z",
    created_at: "2026-06-22T10:01:00.000Z",
    provider: "szamlazz_hu",
    external_id: "order_1",
    pdf_url: "https://www.szamlazz.hu/invoice/test",
    updated_at: "2026-06-22T10:01:00.000Z",
    stripe_checkout_session_id: "cs_test_1",
    stripe_payment_intent_id: "pi_test_1",
    invoice_status: "created",
    sent_to_email: null,
    sent_at: null,
    email_status: "failed",
    email_error_message: "Resend API error",
    email_retry_count: 1,
    billing_tax_number: null,
    ...overrides,
  };
}

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.get("/admin/orders/:publicId/invoice", adminInvoiceStatusRoute);
  instance.post("/admin/orders/:publicId/invoice/retry", adminRetryInvoiceRoute);
  instance.post("/admin/orders/:publicId/invoice/email/retry", adminRetryInvoiceEmailRoute);
  return instance;
}

function kvMock() {
  const values = new Map<string, string>();
  return {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
}

function adminEnv(overrides: Partial<Env> = {}) {
  return {
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    RATE_LIMIT_KV: kvMock(),
    ...overrides,
  } as Env;
}

async function fetchAdmin(path: string, init: RequestInit = {}) {
  return app().fetch(
    new Request(`https://worker.test${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      body: init.body,
    }),
    adminEnv(),
  );
}

describe("admin invoice backend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrderByPublicId.mockResolvedValue(orderFixture({
      payment_status: "paid",
      paid_amount: 890,
      invoice_status: "created",
      invoice_provider: "szamlazz_hu",
      invoice_number: "E-TST-2026-1",
      invoice_external_id: "order_1",
      szamlazz_invoice_id: "order_1",
      szamlazz_invoice_number: "E-TST-2026-1",
      invoice_email_status: "failed",
      invoice_email_error_message: "Resend API error",
    }));
    mocks.getInvoiceByOrderId.mockResolvedValue(invoiceFixture());
    mocks.retryInvoiceForOrder.mockResolvedValue("created");
    mocks.retryInvoiceEmailForOrder.mockResolvedValue(invoiceFixture({ email_status: "sent" }));
  });

  it("requires a valid admin bearer token", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/admin/orders/public_1/invoice"),
      adminEnv(),
    );
    expect(response.status).toBe(401);
    expect(mocks.getOrderByPublicId).not.toHaveBeenCalled();
  });

  it("rate limits admin access before loading order data", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/admin/orders/public_1/invoice", {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
      adminEnv({
        RATE_LIMIT_KV: {
          async get() {
            return "30";
          },
          async put() {},
        } as unknown as KVNamespace,
      }),
    );
    expect(response.status).toBe(429);
    expect(mocks.getOrderByPublicId).not.toHaveBeenCalled();
  });

  it("returns invoice status, Szamlazz number, billing data, and retry error", async () => {
    const response = await fetchAdmin("/admin/orders/public_1/invoice");
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      publicId: "public_1",
      paymentStatus: "paid",
      paidAmount: 890,
      invoice: expect.objectContaining({
        provider: "szamlazz_hu",
        number: "E-TST-2026-1",
        emailStatus: "failed",
        emailErrorMessage: "Resend API error",
        emailRetryCount: 1,
      }),
    });
  });

  it("retries invoice creation only for paid orders through the idempotent pipeline", async () => {
    const response = await fetchAdmin("/admin/orders/public_1/invoice/retry", { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(mocks.retryInvoiceForOrder).toHaveBeenCalledWith(expect.anything(), "order_1");
  });

  it("keeps manual invoice retry closed for unpaid orders", async () => {
    mocks.getOrderByPublicId.mockResolvedValueOnce(orderFixture({ payment_status: "checkout_created" }));
    const response = await fetchAdmin("/admin/orders/public_1/invoice/retry", { method: "POST", body: "{}" });
    expect(response.status).toBe(409);
    expect(mocks.retryInvoiceForOrder).not.toHaveBeenCalled();
  });

  it("retries failed invoice email delivery against the existing invoice", async () => {
    const response = await fetchAdmin("/admin/orders/public_1/invoice/email/retry", { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(mocks.retryInvoiceEmailForOrder).toHaveBeenCalledWith(expect.anything(), "order_1");
    expect(mocks.retryInvoiceForOrder).not.toHaveBeenCalled();
  });
});
