import { describe, expect, it } from "vitest";
import {
  attachStripeSession,
  claimInvoiceProcessing,
  markInvoiceAttemptFailed,
  markOrderPaid,
  markOrderPaymentStatus,
  persistCreatedInvoice,
} from "../src/lib/db";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

function singleStatementEnv(changes = 1) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return {
              async run() {
                return { meta: { changes } };
              },
              async first() {
                return orderFixture({ invoice_status: "processing", invoice_retry_count: 1 });
              },
            };
          },
        };
      },
      async batch(_statements: unknown[]) {
        return [];
      },
    },
  } as unknown as Env;
  return { env, calls };
}

describe("database-level payment and invoice guards", () => {
  it("attaches one Checkout session only to pre-payment states", async () => {
    const { env, calls } = singleStatementEnv();
    await expect(attachStripeSession(env, "order_1", "cs_test_1")).resolves.toBe(true);
    expect(calls[0].sql).toContain("payment_status IN ('pending', 'checkout_created')");
    expect(calls[0].sql).toContain("stripe_session_id IS NULL OR stripe_session_id = ?");
  });

  it("marks paid with a conditional update and starts invoice pending atomically", async () => {
    const { env, calls } = singleStatementEnv();
    await expect(
      markOrderPaid(env, "order_1", {
        stripeSessionId: "cs_test_1",
        stripePaymentIntentId: "pi_test_1",
      }),
    ).resolves.toBe(true);
    expect(calls[0].sql).toContain("payment_status IN ('pending', 'checkout_created', 'failed')");
    expect(calls[0].sql).toContain("invoice_status = CASE");
    expect(calls[0].sql).toContain("THEN 'pending'");
  });

  it("never allows a later failed/expired event to downgrade paid", async () => {
    const { env, calls } = singleStatementEnv(0);
    await expect(markOrderPaymentStatus(env, "order_1", "failed")).resolves.toBe(false);
    expect(calls[0].args).not.toContain("paid");
    expect(calls[0].args).not.toContain("refunded");
  });

  it("claims invoice work only for paid checkout orders and at most five attempts", async () => {
    const { env, calls } = singleStatementEnv();
    await expect(claimInvoiceProcessing(env, "order_1")).resolves.not.toBeNull();
    expect(calls[0].sql).toContain("payment_status = 'paid'");
    expect(calls[0].sql).toContain("billing_source = 'checkout'");
    expect(calls[0].sql).toContain("invoice_retry_count < 5");
    expect(calls[0].sql).toContain("invoice_status = 'pending'");
  });

  it("persists invoice and refund-correction state in one D1 batch", async () => {
    const { env, calls } = singleStatementEnv();
    await persistCreatedInvoice(env, orderFixture(), {
      id: "invoice_1",
      invoiceNumber: "E-TST-2026-1",
      provider: "szamlazz",
      externalId: "order_1",
      pdfUrl: null,
      issuedAt: "2026-06-22T10:01:00.000Z",
      status: "created",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("INSERT OR IGNORE INTO invoices");
    expect(calls[1].sql).toContain("invoice_status = ?");
    expect(calls[1].sql).toContain("payment_status IN ('refunded', 'partially_refunded')");
    expect(calls[1].sql).toContain("manual_required");
  });

  it("stops retrying after the fifth Szamlazz.hu attempt", async () => {
    const { env, calls } = singleStatementEnv();
    await expect(
      markInvoiceAttemptFailed(env, "order_1", {
        retryable: true,
        errorCode: "HTTP_503",
        errorMessage: "Átmeneti hiba.",
        retryCount: 5,
      }),
    ).resolves.toBe("failed");
    expect(calls[0].args[0]).toBe("failed");
    expect(calls[0].args[3]).toBeNull();
  });
});
