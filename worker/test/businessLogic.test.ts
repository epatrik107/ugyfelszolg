import { describe, expect, it } from "vitest";
import { claimStripeEvent, consumeMagicLink } from "../src/lib/db";
import { constantTimeEqual, hashToken } from "../src/lib/hash";
import { canStartGeneration, canTransitionPaymentStatus } from "../src/lib/orderState";
import { getPackage } from "../src/lib/packages";
import { hasAvailableQuota } from "../src/lib/db";
import { RATE_LIMITS } from "../src/lib/rateLimit";
import { reviewLetterWithRules } from "../src/lib/review";
import { verifyStripeWebhook } from "../src/lib/stripe";
import type { Env } from "../src/lib/types";
import { validateAiOutput } from "../src/lib/openai";

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

describe("packages", () => {
  it("keeps package pricing server-side and fixed", () => {
    expect(getPackage("basic").price).toBe(1990);
    expect(getPackage("premium").price).toBe(4990);
    expect(getPackage("business").price).toBe(19900);
  });
});

describe("payment transitions", () => {
  it("allows only safe status transitions", () => {
    expect(canTransitionPaymentStatus("pending", "paid")).toBe(true);
    expect(canTransitionPaymentStatus("paid", "refunded")).toBe(true);
    expect(canTransitionPaymentStatus("paid", "failed")).toBe(false);
    expect(canTransitionPaymentStatus("expired", "paid")).toBe(false);
  });
});

describe("token comparison", () => {
  it("checks equal hashes without accepting mismatches", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("produces deterministic HMAC hashes for stored token verification", async () => {
    await expect(hashToken("token", "secret")).resolves.toBe(
      await hashToken("token", "secret"),
    );
    await expect(hashToken("token", "secret-a")).resolves.not.toBe(
      await hashToken("token", "secret-b"),
    );
  });
});

describe("generation gating", () => {
  it("starts only once after payment", () => {
    expect(
      canStartGeneration({
        payment_status: "paid",
        ai_status: "not_started",
        generation_count: 0,
      }),
    ).toBe(true);
    expect(
      canStartGeneration({
        payment_status: "pending",
        ai_status: "not_started",
        generation_count: 0,
      }),
    ).toBe(false);
    expect(
      canStartGeneration({
        payment_status: "paid",
        ai_status: "completed",
        generation_count: 1,
      }),
    ).toBe(false);
  });
});

describe("subscription quota", () => {
  it("stops when used and reserved letters reach the quota", () => {
    expect(hasAvailableQuota({ quota: 10, used_count: 8, reserved_count: 1 })).toBe(true);
    expect(hasAvailableQuota({ quota: 10, used_count: 9, reserved_count: 1 })).toBe(false);
  });
});

describe("review pipeline", () => {
  it("accepts a polite structured Hungarian letter", () => {
    const result = reviewLetterWithRules(`Tárgy: Reklamáció

Tisztelt Ügyfélszolgálat!

Kérem, vizsgálják ki a hibás teljesítést, és jelezzék a javasolt megoldást.

Tisztelettel:
Név`);
    expect(result.ok).toBe(true);
  });

  it("rejects unsafe promises", () => {
    const result = reviewLetterWithRules(`Tárgy: Panasz

Tisztelt Címzett!

Biztosan pert nyer, kérem azonnal intézkedjenek.

Tisztelettel`);
    expect(result.ok).toBe(false);
  });
});

describe("stripe webhook idempotency", () => {
  it("claims an event only once", async () => {
    const seen = new Set<string>();
    const fakeEnv = {
      DB: {
        prepare() {
          return {
            bind(eventId: string) {
              return {
                async run() {
                  if (seen.has(eventId)) {
                    return { meta: { changes: 0 } };
                  }
                  seen.add(eventId);
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(claimStripeEvent(fakeEnv, "evt_1", "checkout.session.completed")).resolves.toBe(
      true,
    );
    await expect(claimStripeEvent(fakeEnv, "evt_1", "checkout.session.completed")).resolves.toBe(
      false,
    );
  });
});

describe("stripe webhook signature verification", () => {
  it("rejects replayed webhook signatures outside tolerance", async () => {
    const body = JSON.stringify({
      id: "evt_old",
      type: "checkout.session.completed",
      data: { object: { id: "cs_old" } },
    });
    const timestamp = Math.floor(Date.now() / 1000) - 1000;
    const signature = await hmacSha256Hex("whsec_test", `${timestamp}.${body}`);

    await expect(
      verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`, "whsec_test"),
    ).resolves.toBeNull();
  });
});

describe("business magic link consumption", () => {
  it("marks a magic link consumed only once", async () => {
    const consumed = new Set<string>();
    const fakeEnv = {
      DB: {
        prepare() {
          return {
            bind(_date: string, id: string) {
              return {
                async run() {
                  if (consumed.has(id)) {
                    return { meta: { changes: 0 } };
                  }
                  consumed.add(id);
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(consumeMagicLink(fakeEnv, "magic_1")).resolves.toBe(true);
    await expect(consumeMagicLink(fakeEnv, "magic_1")).resolves.toBe(false);
  });
});

describe("AI output validation", () => {
  it("accepts a well-formed short letter", () => {
    const letter =
      "Tárgy: Reklamáció\n\nTisztelt Ügyfélszolgálat!\n\nKérem az ügy megoldását.\n\nTisztelettél:\nPéter";
    expect(() => validateAiOutput(letter)).not.toThrow();
    expect(validateAiOutput(letter)).toBe(letter);
  });

  it("rejects output that exceeds the character limit", () => {
    const oversized = "a".repeat(12_001);
    expect(() => validateAiOutput(oversized)).toThrow(/túl hosszú/);
  });

  it("accepts output exactly at the character limit", () => {
    const atLimit = "a".repeat(12_000);
    expect(() => validateAiOutput(atLimit)).not.toThrow();
  });

  it("strips null bytes and non-printable ASCII control characters but keeps newlines", () => {
    const withControlChars =
      "Tárgy: Test\x00\x01\x07\x0e\x1f Tisztelt Cím!\n\nKérem.\n\nTisztelettél";
    const sanitized = validateAiOutput(withControlChars);
    expect(sanitized).not.toContain("\x00");
    expect(sanitized).not.toContain("\x01");
    expect(sanitized).toContain("\n");
  });
});

describe("prompt injection resistance in review pipeline", () => {
  it("flags a letter that contains aggressive patterns (injection side-effect)", () => {
    const injectedLetter = `Tárgy: Panasz

Tisztelt Cím!

Kérem a megoldást. Fenyeget és megsemmisít mindent.

Tisztelettel`;
    const result = reviewLetterWithRules(injectedLetter);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("accepts a clean letter that contains no injected content", () => {
    const clean = `Tárgy: Reklamáció

Tisztelt Ügyfélszolgálat!

Kérem vizsgálják ki az ügyet.

Tisztelettel:
Felhasználó`;
    expect(reviewLetterWithRules(clean).ok).toBe(true);
  });
});

describe("constant-time comparison", () => {
  it("returns false for strings of different lengths", () => {
    expect(constantTimeEqual("short", "much-longer-string")).toBe(false);
    expect(constantTimeEqual("much-longer-string", "short")).toBe(false);
  });

  it("returns true only for identical strings", () => {
    expect(constantTimeEqual("demo-code-xyz", "demo-code-xyz")).toBe(true);
    expect(constantTimeEqual("demo-code-xyz", "demo-code-XYZ")).toBe(false);
  });
});

describe("rate limit scopes", () => {
  it("defines all required scopes including business-session-ip", () => {
    const expectedScopes: (keyof typeof RATE_LIMITS)[] = [
      "create-checkout-ip",
      "create-checkout-email",
      "result-ip",
      "contact-ip",
      "contact-email",
      "business-access-ip",
      "business-magic-ip",
      "business-session-ip",
    ];
    for (const scope of expectedScopes) {
      expect(RATE_LIMITS[scope].limit).toBeGreaterThan(0);
      expect(RATE_LIMITS[scope].windowSeconds).toBeGreaterThan(0);
    }
  });

  it("applies tighter limits on order creation than on read endpoints", () => {
    expect(RATE_LIMITS["create-checkout-ip"].limit).toBeLessThan(
      RATE_LIMITS["result-ip"].limit,
    );
  });
});
