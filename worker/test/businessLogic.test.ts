import { afterEach, describe, expect, it, vi } from "vitest";
import { claimStripeEvent, consumeMagicLink, insertOrder } from "../src/lib/db";
import { constantTimeEqual, hashToken } from "../src/lib/hash";
import { createInvoice, selectInvoiceProvider } from "../src/lib/invoice";
import { canStartGeneration, canRequestRegeneration, canTransitionPaymentStatus, MAX_REGENERATIONS } from "../src/lib/orderState";
import { getPackage } from "../src/lib/packages";
import { hasAvailableQuota } from "../src/lib/db";
import { RATE_LIMITS } from "../src/lib/rateLimit";
import { reviewLetterWithRules } from "../src/lib/review";
import { isAllowedOrigin } from "../src/lib/security";
import { verifyStripeWebhook } from "../src/lib/stripe";
import type { Env, OrderRow } from "../src/lib/types";
import { regenerationSchema } from "../src/lib/validation";
import { buildUserPrompt, validateAiOutput } from "../src/lib/ai";

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
    expect(getPackage("basic").price).toBe(890);
    expect(getPackage("premium").price).toBe(3900);
    expect(getPackage("premium_plus").price).toBe(10900);
  });

  it("basic package has no premium model and 1 max regeneration", () => {
    const basic = getPackage("basic");
    expect(basic.capabilities.isPremiumModel).toBe(false);
    expect(basic.capabilities.maxRegenerations).toBe(1);
    expect(basic.capabilities.hasAlternatives).toBe(false);
    expect(basic.capabilities.hasUsageTips).toBe(false);
  });

  it("premium package uses premium model and allows up to 3 regenerations", () => {
    const premium = getPackage("premium");
    expect(premium.capabilities.isPremiumModel).toBe(true);
    expect(premium.capabilities.maxRegenerations).toBe(3);
    expect(premium.capabilities.hasAlternatives).toBe(true);
    expect(premium.capabilities.hasUsageTips).toBe(true);
  });

  it("premium plus uses premium model and allows up to 3 regenerations", () => {
    const premiumPlus = getPackage("premium_plus");
    expect(premiumPlus.capabilities.isPremiumModel).toBe(true);
    expect(premiumPlus.capabilities.maxRegenerations).toBe(3);
    expect(premiumPlus.capabilities.hasAlternatives).toBe(true);
    expect(premiumPlus.capabilities.hasUsageTips).toBe(true);
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

describe("cors origin matching", () => {
  const env = {
    ALLOWED_ORIGINS: "https://ügyfelszolgalat.hu,https://epatrik107.github.io",
  } as unknown as Env;

  it("matches IDN domains in browser origin format", () => {
    expect(isAllowedOrigin("https://xn--gyfelszolgalat-fsb.hu", env)).toBe(true);
  });

  it("rejects origins outside the allowlist", () => {
    expect(isAllowedOrigin("https://example.com", env)).toBe(false);
  });
});

describe("order persistence security", () => {
  it("does not store raw result_token in the database", async () => {
    const executedSql: string[] = [];
    const fakeEnv = {
      DB: {
        prepare(sql: string) {
          executedSql.push(sql);
          return {
            bind(..._args: unknown[]) {
              return {
                async run() {
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await insertOrder(fakeEnv, {
      id: "order_1",
      publicId: "public_1",
      resultTokenHash: "hash_only",
      email: "patrik@example.com",
      name: "Patrik",
      letterType: "Panaszlevél",
      recipient: "Ügyfélszolgálat",
      problemDescription: "A szolgáltatás nem megfelelően működött.",
      desiredResult: "Kérem a hiba javítását.",
      tone: "Udvarias",
      previousMessages: "",
      selectedPackage: "basic",
      price: 890,
      currency: "HUF",
      paymentStatus: "paid",
    });

    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).not.toContain("result_token,");
    expect(executedSql[0]).toContain("result_token_hash");
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

describe("regeneration gating", () => {
  it("exports MAX_REGENERATIONS as 3 (default fallback)", () => {
    expect(MAX_REGENERATIONS).toBe(3);
  });

  it("allows regeneration when paid+completed and generation_count is within package limit", () => {
    // basic package allows only 1 regeneration
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "completed", generation_count: 1 }, 1),
    ).toBe(true);
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "completed", generation_count: 2 }, 1),
    ).toBe(false);
    // premium packages allow 3
    for (let count = 1; count <= 3; count++) {
      expect(
        canRequestRegeneration({ payment_status: "paid", ai_status: "completed", generation_count: count }, 3),
      ).toBe(true);
    }
  });

  it("blocks regeneration when generation_count exceeds MAX_REGENERATIONS (default)", () => {
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "completed", generation_count: MAX_REGENERATIONS + 1 }),
    ).toBe(false);
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "completed", generation_count: 99 }),
    ).toBe(false);
  });

  it("blocks regeneration when payment is not paid", () => {
    expect(
      canRequestRegeneration({ payment_status: "pending", ai_status: "completed", generation_count: 1 }),
    ).toBe(false);
  });

  it("blocks regeneration when ai_status is not completed (still in-flight or failed)", () => {
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "generating", generation_count: 1 }),
    ).toBe(false);
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "failed", generation_count: 1 }),
    ).toBe(false);
    expect(
      canRequestRegeneration({ payment_status: "paid", ai_status: "not_started", generation_count: 0 }),
    ).toBe(false);
  });
});

describe("regeneration feedback", () => {
  it("rejects empty feedback in the regeneration payload", () => {
    expect(regenerationSchema.safeParse({ feedback: "   " }).success).toBe(false);
  });

  it("accepts meaningful feedback in the regeneration payload", () => {
    const parsed = regenerationSchema.safeParse({ feedback: "Legyen rövidebb és közvetlenebb." });
    expect(parsed.success).toBe(true);
  });

  it("includes user feedback in the AI prompt for targeted regeneration", () => {
    const order = {
      id: "order_1",
      public_id: "public_1",
      result_token_hash: "hash",
      email: "teszt@example.com",
      name: "Teszt Elek",
      letter_type: "Panaszlevél",
      recipient: "Ügyfélszolgálat",
      problem_description: "Hosszú a válaszidő.",
      desired_result: "Gyorsabb ügyintézés",
      tone: "Udvarias",
      previous_messages: null,
      selected_package: "basic",
      server_calculated_price: 890,
      currency: "HUF",
      payment_status: "paid",
      ai_status: "completed",
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      generated_letter: null,
      generation_count: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      generated_at: null,
      error_message: null,
      subscription_id: null,
      billing_source: "checkout",
      letter_history: null,
      letter_email_sent: 0,
      checkout_idempotency_key: null,
      checkout_input_hash: null,
      paid_amount: 890,
      customer_email: "teszt@example.com",
      billing_buyer_type: "individual",
      billing_name: "Teszt Elek",
      billing_email: "teszt@example.com",
      billing_country: "HU",
      billing_postal_code: "1111",
      billing_city: "Budapest",
      billing_address_line1: "Példa utca 1.",
      billing_tax_number: null,
      invoice_status: "not_required",
      invoice_provider: null,
      invoice_number: null,
      invoice_external_id: null,
      invoice_pdf_url: null,
      szamlazz_invoice_id: null,
      szamlazz_invoice_number: null,
      invoice_sent_to_email: null,
      invoice_sent_at: null,
      invoice_created_at: null,
      invoice_email_status: "not_required",
      invoice_email_error_message: null,
      invoice_error_code: null,
      invoice_error_message: null,
      invoice_retry_count: 0,
      invoice_last_attempted_at: null,
      invoice_next_retry_at: null,
      invoiced_at: null,
      refund_invoice_status: "not_required",
      refund_amount: null,
      refund_stripe_id: null,
      letter_email_sent_versions: null,
    } satisfies OrderRow;

    const feedback = "Legyen rövidebb és barátságosabb.";
    const prompt = buildUserPrompt(order, [], feedback);

    expect(prompt).toContain("Felhasználói módosítási kérés:");
    expect(prompt).toContain(feedback);
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
        prepare(sql: string) {
          return {
            bind(...args: string[]) {
              return {
                async run() {
                  if (!sql.includes("INSERT OR IGNORE")) return { meta: { changes: 0 } };
                  const eventId = args[0];
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

describe("magic link consumption", () => {
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
  it("warning patterns produce issues but do not block (ok=true)", () => {
    const injectedLetter = `Tárgy: Panasz

Tisztelt Cím!

Kérem a megoldást. Fenyeget és megsemmisít mindent.

Tisztelettel`;
    const result = reviewLetterWithRules(injectedLetter);
    // "fenyeget" and "megsemmisít" are warnings now, not blockers
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
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
  it("defines all required public scopes", () => {
    const expectedScopes: (keyof typeof RATE_LIMITS)[] = [
      "create-checkout-ip",
      "create-checkout-email",
      "result-ip",
      "contact-ip",
      "contact-email",
      "regenerate-ip",
      "send-letter-ip",
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

// ─── Invoice provider selection ──────────────────────────────────────────────

describe("invoice provider selection", () => {
  it("uses the internal provider in test/development mode (no SZAMLAZZ_AGENT_KEY)", () => {
    expect(selectInvoiceProvider({} as Env)).toBe("internal");
    expect(selectInvoiceProvider({ SZAMLAZZ_AGENT_KEY: "" } as unknown as Env)).toBe("internal");
    expect(selectInvoiceProvider({ SZAMLAZZ_AGENT_KEY: undefined } as unknown as Env)).toBe(
      "internal",
    );
  });

  it("uses the szamlazz provider in production (SZAMLAZZ_AGENT_KEY is set)", () => {
    expect(
      selectInvoiceProvider({ SZAMLAZZ_AGENT_KEY: "live-agent-key-123" } as unknown as Env),
    ).toBe("szamlazz_hu");
  });
});

// ─── createInvoice – internal path (test/development) ────────────────────────

describe("createInvoice internal path", () => {
  it("creates an internal SZ-YYYY-NNNN invoice without calling fetch when no agent key is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const sqlCalls: string[] = [];
    let seqValue = 0;

    const fakeEnv = {
      // No SZAMLAZZ_AGENT_KEY → internal path
      DB: {
        prepare(sql: string) {
          sqlCalls.push(sql);
          return {
            bind(..._args: unknown[]) {
              return {
                async run() {
                  return { meta: { changes: 1 } };
                },
                async first() {
                  if (sql.includes("invoice_sequence")) {
                    seqValue += 1;
                    return { last_number: seqValue };
                  }
                  return null;
                },
              };
            },
          };
        },
        async batch(_stmts: unknown[]) {
          return [];
        },
      },
    } as unknown as Env;

    const order = {
      id: "order-test-1",
      email: "test@example.com",
      name: "Teszt Felhasználó",
      server_calculated_price: 890,
      currency: "HUF",
      paid_at: "2024-06-01T10:00:00.000Z",
      selected_package: "basic" as const,
      billing_name: "Teszt Felhasználó",
      billing_email: "test@example.com",
      billing_buyer_type: "individual" as const,
      billing_country: "HU",
      billing_postal_code: "1111",
      billing_city: "Budapest",
      billing_address_line1: "Példa utca 1.",
      billing_tax_number: null,
      invoice_retry_count: 1,
      stripe_session_id: "cs_test_1",
      stripe_payment_intent_id: "pi_test_1",
    };

    const invoice = await createInvoice(fakeEnv, order);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invoice.invoice_number).toMatch(/^TEST-\d{4}-\d{6}$/);
    expect(invoice.order_id).toBe("order-test-1");
    expect(invoice.amount).toBe(890);
    expect(sqlCalls.some((sql) => sql.includes("ON CONFLICT") && sql.includes("RETURNING"))).toBe(true);

    fetchSpy.mockRestore();
  });
});

// ─── createInvoice – szamlazz.hu path (production) ───────────────────────────

describe("createInvoice szamlazz.hu path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls szamlazz.hu and stores the returned invoice number in production mode", async () => {
    const mockInvoiceNumber = "SZKKFT-2024-0001";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { szlahu_szamlaszam: mockInvoiceNumber },
      }),
    );

    let storedInvoiceNumber: unknown;
    const fakeEnv = {
      SZAMLAZZ_AGENT_KEY: "live-agent-key-123",
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              if (sql.includes("INTO invoices")) {
                storedInvoiceNumber = args[2]; // invoice_number is the 3rd bind param
              }
              return {
                async run() {
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        },
        async batch(_stmts: unknown[]) {
          return [];
        },
      },
    } as unknown as Env;

    const order = {
      id: "order-prod-1",
      email: "production@example.com",
      name: "Éles Felhasználó",
      server_calculated_price: 3900,
      currency: "HUF",
      paid_at: "2024-06-15T12:00:00.000Z",
      selected_package: "premium" as const,
      billing_name: "Éles Felhasználó",
      billing_email: "production@example.com",
      billing_buyer_type: "individual" as const,
      billing_country: "HU",
      billing_postal_code: "1111",
      billing_city: "Budapest",
      billing_address_line1: "Példa utca 1.",
      billing_tax_number: null,
      invoice_retry_count: 1,
      stripe_session_id: "cs_live_1",
      stripe_payment_intent_id: "pi_live_1",
    };

    const invoice = await createInvoice(fakeEnv, order);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://www.szamlazz.hu/szamla/");

    expect(invoice.invoice_number).toBe(mockInvoiceNumber);
    expect(storedInvoiceNumber).toBe(mockInvoiceNumber);
    expect(invoice.order_id).toBe("order-prod-1");
    expect(invoice.amount).toBe(3900);
  });

  it("throws when szamlazz.hu returns an error response header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { szlahu_error_code: "3", szlahu_error: "Hibás agent kulcs" },
      }),
    );

    const fakeEnv = {
      SZAMLAZZ_AGENT_KEY: "bad-key",
      DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    } as unknown as Env;

    const order = {
      id: "order-err-1",
      email: "err@example.com",
      name: "Hiba Teszt",
      server_calculated_price: 890,
      currency: "HUF",
      paid_at: "2024-06-15T12:00:00.000Z",
      selected_package: "basic" as const,
      billing_name: "Hiba Teszt",
      billing_email: "err@example.com",
      billing_buyer_type: "individual" as const,
      billing_country: "HU",
      billing_postal_code: "1111",
      billing_city: "Budapest",
      billing_address_line1: "Példa utca 1.",
      billing_tax_number: null,
      invoice_retry_count: 1,
      stripe_session_id: "cs_test_err",
      stripe_payment_intent_id: "pi_test_err",
    };

    await expect(createInvoice(fakeEnv, order)).rejects.toThrow();
  });

  it("does NOT include the agent key in the thrown error message", async () => {
    const agentKey = "super-secret-agent-key-xyz";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 500,
      }),
    );

    const fakeEnv = {
      SZAMLAZZ_AGENT_KEY: agentKey,
      DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    } as unknown as Env;

    const order = {
      id: "order-sec-1",
      email: "sec@example.com",
      name: "Sec Teszt",
      server_calculated_price: 890,
      currency: "HUF",
      paid_at: "2024-06-15T12:00:00.000Z",
      selected_package: "basic" as const,
      billing_name: "Sec Teszt",
      billing_email: "sec@example.com",
      billing_buyer_type: "individual" as const,
      billing_country: "HU",
      billing_postal_code: "1111",
      billing_city: "Budapest",
      billing_address_line1: "Példa utca 1.",
      billing_tax_number: null,
      invoice_retry_count: 1,
      stripe_session_id: "cs_test_sec",
      stripe_payment_intent_id: "pi_test_sec",
    };

    await expect(createInvoice(fakeEnv, order)).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !e.message.includes(agentKey),
    );
  });
});
