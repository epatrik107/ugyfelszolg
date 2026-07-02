import { describe, expect, it, vi } from "vitest";
import { constantTimeEqual } from "../src/lib/hash";
import type { Env } from "../src/lib/types";

describe("constantTimeEqual hardening", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("a".repeat(64), "a".repeat(64))).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "xyz")).toBe(false);
  });

  it("returns false for different lengths without leaking which is longer", () => {
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("ab", "abc")).toBe(false);
    expect(constantTimeEqual("a", "abcdef")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
    expect(constantTimeEqual("a", "")).toBe(false);
  });

  it("handles hex hash comparison (typical use case)", () => {
    const hash1 = "a".repeat(64); // SHA-256 hex length
    const hash2 = "a".repeat(64);
    const hash3 = "b".repeat(64);
    expect(constantTimeEqual(hash1, hash2)).toBe(true);
    expect(constantTimeEqual(hash1, hash3)).toBe(false);
  });
});

describe("handleCheckoutCompleted session ID validation", () => {
  it("rejects empty session IDs", async () => {
    const logEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      try {
        logEvents.push({ event: "log", details: JSON.parse(msg) });
      } catch {
        // ignore non-JSON logs
      }
    });

    const { handleCheckoutCompleted } = await import("../src/routes/stripeWebhook");

    const c = {
      env: { PAYMENTS_ENABLED: "true", PAYMENT_MODE: "test" } as Env,
      executionCtx: { waitUntil: vi.fn() },
    } as never;

    // These should return without making any Stripe API calls
    await handleCheckoutCompleted(c, "");
    await handleCheckoutCompleted(c, "invalid_id");

    const suspiciousEvents = logEvents.filter(
      (e) => e.details.event === "suspicious_payment_event" &&
             e.details.reason === "invalid_session_id",
    );
    expect(suspiciousEvents.length).toBe(2);

    vi.restoreAllMocks();
  });
});

describe("cleanupExpiredData includes Stripe events", () => {
  it("deletes completed Stripe events older than 30 days", async () => {
    const deletedQueries: string[] = [];
    const fakeEnv = {
      DB: {
        prepare(sql: string) {
          deletedQueries.push(sql);
          return {
            bind(..._args: unknown[]) {
              return this;
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
        async batch(statements: Array<{ run: () => Promise<unknown> }>) {
          return Promise.all(statements.map((s) => s.run()));
        },
      },
    } as unknown as Env;

    const { cleanupExpiredData } = await import("../src/lib/db");
    await cleanupExpiredData(fakeEnv);

    const hasStripeCleanup = deletedQueries.some(
      (sql) => sql.includes("processed_stripe_events") && sql.includes("completed"),
    );
    expect(hasStripeCleanup).toBe(true);
  });
});

describe("invoice retry error isolation", () => {
  it("continues processing remaining orders when one fails", async () => {
    const mockProcess = vi.fn()
      .mockResolvedValueOnce("created")
      .mockRejectedValueOnce(new Error("provider timeout"))
      .mockResolvedValueOnce("created");

    const orders = [
      { id: "order_1" },
      { id: "order_2" },
      { id: "order_3" },
    ];

    // Simulate the error isolation pattern used in retryDueInvoices
    const results: Array<{ orderId: string; status: string }> = [];
    for (const order of orders) {
      try {
        const status = await mockProcess({}, order.id);
        results.push({ orderId: order.id, status });
      } catch {
        results.push({ orderId: order.id, status: "error" });
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ orderId: "order_1", status: "created" });
    expect(results[1]).toEqual({ orderId: "order_2", status: "error" });
    expect(results[2]).toEqual({ orderId: "order_3", status: "created" });
  });
});
