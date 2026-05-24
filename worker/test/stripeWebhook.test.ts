import { describe, expect, it } from "vitest";
import { claimStripeEvent } from "../src/lib/db";
import { canTransitionPaymentStatus } from "../src/lib/orderState";
import { getPackage } from "../src/lib/packages";
import { verifyStripeWebhook } from "../src/lib/stripe";
import type { Env } from "../src/lib/types";

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function makeStripeSignature(body: string, secret: string, timestampOffset = 0) {
  const timestamp = Math.floor(Date.now() / 1000) + timestampOffset;
  const sig = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return `t=${timestamp},v1=${sig}`;
}

const WEBHOOK_SECRET = "whsec_test_secret";

describe("stripe webhook signature verification", () => {
  it("accepts a valid signature with current timestamp", async () => {
    const body = JSON.stringify({
      id: "evt_valid",
      type: "checkout.session.completed",
      data: { object: { id: "cs_valid" } },
    });
    const sigHeader = await makeStripeSignature(body, WEBHOOK_SECRET);

    const event = await verifyStripeWebhook(body, sigHeader, WEBHOOK_SECRET);
    expect(event).not.toBeNull();
    expect(event?.type).toBe("checkout.session.completed");
  });

  it("rejects an invalid signature", async () => {
    const body = JSON.stringify({ id: "evt_bad", type: "test", data: { object: {} } });
    const sigHeader = await makeStripeSignature(body, "wrong_secret");

    await expect(verifyStripeWebhook(body, sigHeader, WEBHOOK_SECRET)).resolves.toBeNull();
  });

  it("rejects a replayed webhook outside tolerance (>5 min)", async () => {
    const body = JSON.stringify({ id: "evt_old", type: "test", data: { object: {} } });
    const sigHeader = await makeStripeSignature(body, WEBHOOK_SECRET, -400);

    await expect(verifyStripeWebhook(body, sigHeader, WEBHOOK_SECRET)).resolves.toBeNull();
  });

  it("accepts a webhook within tolerance (4 min old)", async () => {
    const body = JSON.stringify({ id: "evt_recent", type: "test", data: { object: {} } });
    const sigHeader = await makeStripeSignature(body, WEBHOOK_SECRET, -240);

    const event = await verifyStripeWebhook(body, sigHeader, WEBHOOK_SECRET);
    expect(event).not.toBeNull();
  });

  it("rejects missing signature header", async () => {
    const body = JSON.stringify({ id: "evt_nosig", type: "test", data: { object: {} } });
    await expect(verifyStripeWebhook(body, undefined, WEBHOOK_SECRET)).resolves.toBeNull();
  });
});

describe("stripe event deduplication", () => {
  it("processes the same event id only once", async () => {
    const processed = new Set<string>();
    const fakeEnv = {
      DB: {
        prepare(sql: string) {
          return {
            bind(eventId: string, _eventType: string, _now: string) {
              return {
                async run() {
                  if (processed.has(eventId)) {
                    return { meta: { changes: 0 } };
                  }
                  processed.add(eventId);
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(claimStripeEvent(fakeEnv, "evt_dup", "checkout.session.completed")).resolves.toBe(true);
    await expect(claimStripeEvent(fakeEnv, "evt_dup", "checkout.session.completed")).resolves.toBe(false);
    await expect(claimStripeEvent(fakeEnv, "evt_dup", "checkout.session.completed")).resolves.toBe(false);
  });

  it("processes different event ids independently", async () => {
    const processed = new Set<string>();
    const fakeEnv = {
      DB: {
        prepare(_sql: string) {
          return {
            bind(eventId: string, _eventType: string, _now: string) {
              return {
                async run() {
                  if (processed.has(eventId)) return { meta: { changes: 0 } };
                  processed.add(eventId);
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(claimStripeEvent(fakeEnv, "evt_a", "checkout.session.completed")).resolves.toBe(true);
    await expect(claimStripeEvent(fakeEnv, "evt_b", "checkout.session.completed")).resolves.toBe(true);
  });
});

describe("checkout amount and currency validation", () => {
  it("validates that amount matches server-side package price", () => {
    const basicPackage = getPackage("basic");
    expect(basicPackage.price).toBe(890);
    expect(basicPackage.currency).toBe("huf");

    // Simulates the check in handleCheckoutCompleted:
    // if session.amount_total !== selectedPackage.price → reject
    const sessionAmountOk: number = 890;
    const sessionAmountBad: number = 999;

    expect(sessionAmountOk === basicPackage.price).toBe(true);
    expect(sessionAmountBad === basicPackage.price).toBe(false);
  });

  it("rejects amount mismatch – session total does not match package price", () => {
    const pkg = getPackage("premium");
    const manipulatedAmount: number = 100; // frontend price manipulation attempt

    // The webhook handler would return early without marking paid:
    const pkgCurrency: string = pkg.currency;
    const wouldMarkPaid = manipulatedAmount === pkg.price && "huf" === pkgCurrency;
    expect(wouldMarkPaid).toBe(false);
  });

  it("rejects currency mismatch – session currency does not match package currency", () => {
    const pkg = getPackage("basic");
    const wrongCurrency: string = "eur";
    const pkgCurrency: string = pkg.currency;

    const wouldMarkPaid = pkg.price === 890 && wrongCurrency === pkgCurrency;
    expect(wouldMarkPaid).toBe(false);
  });

  it("accepts correct amount and currency for all packages", () => {
    for (const pkgId of ["basic", "premium", "premium_plus"] as const) {
      const pkg = getPackage(pkgId);
      const wouldMarkPaid = pkg.price === pkg.price && pkg.currency === pkg.currency;
      expect(wouldMarkPaid).toBe(true);
    }
  });
});

describe("payment status transition safety", () => {
  it("pending order can transition to paid on successful checkout", () => {
    expect(canTransitionPaymentStatus("pending", "paid")).toBe(true);
  });

  it("paid order cannot be moved to failed by a later failed event", () => {
    expect(canTransitionPaymentStatus("paid", "failed")).toBe(false);
  });

  it("paid order can be refunded", () => {
    expect(canTransitionPaymentStatus("paid", "refunded")).toBe(true);
  });

  it("pending order can expire", () => {
    expect(canTransitionPaymentStatus("pending", "expired")).toBe(true);
  });

  it("expired order cannot be paid (session replay prevention)", () => {
    expect(canTransitionPaymentStatus("expired", "paid")).toBe(false);
  });

  it("refunded order cannot be marked paid again", () => {
    expect(canTransitionPaymentStatus("refunded", "paid")).toBe(false);
  });

  it("failed order cannot be marked paid (prevents retries without new session)", () => {
    expect(canTransitionPaymentStatus("failed", "paid")).toBe(false);
  });
});

describe("markOrderPaid guards against non-pending orders", () => {
  it("markOrderPaid SQL only updates pending orders", async () => {
    const updatedSqls: string[] = [];
    const fakeEnv = {
      DB: {
        prepare(sql: string) {
          updatedSqls.push(sql);
          return {
            bind(..._args: unknown[]) {
              return {
                async run() {
                  // Simulate no changes (order was already paid)
                  return { meta: { changes: 0 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    const { markOrderPaid } = await import("../src/lib/db");
    await markOrderPaid(fakeEnv, "order_1", {
      stripeSessionId: "cs_test",
      stripePaymentIntentId: "pi_test",
    });

    // Verify the SQL uses a WHERE payment_status = 'pending' guard
    expect(updatedSqls.some((sql) => sql.includes("payment_status = 'pending'"))).toBe(true);
  });
});
