import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateAamInvoiceAmounts,
  calculateOrderPrice,
  detectSuspiciousCheckoutInput,
  looksLikeBusinessName,
} from "../src/lib/billing";
import {
  buildInvoiceXml,
  buildSzamlazzPayload,
  InvoiceProviderError,
  issueSzamlazzInvoice,
} from "../src/lib/szamlazz";
import {
  createCheckoutSession,
  fromStripeMinorAmount,
  toStripeMinorAmount,
} from "../src/lib/stripe";
import type { Env } from "../src/lib/types";
import { checkoutSchema } from "../src/lib/validation";
import { orderFixture } from "./fixtures";

const validCheckout = {
  name: "Teszt Elek",
  email: "kapcsolat@example.com",
  letterType: "Panaszlevél",
  recipient: "Ügyfélszolgálat",
  problemDescription: "A szolgáltatás több mint két hete nem működik megfelelően.",
  desiredResult: "Kérem a szolgáltatás kijavítását.",
  tone: "Udvarias",
  previousMessages: "",
  selectedPackage: "basic",
  checkoutAttemptId: "84c31d7f-0c7c-4bf8-85e5-fcd6a0949681",
  billing: {
    buyerType: "individual",
    name: "Teszt Elek",
    email: "szamla@example.com",
    country: "HU",
    postalCode: "1111",
    city: "Budapest",
    addressLine1: "Példa utca 1.",
  },
  legalAccepted: true,
  turnstileToken: "turnstile",
  demoAccessCode: "",
};

afterEach(() => vi.restoreAllMocks());

describe("checkout billing validation", () => {
  it("accepts a complete Hungarian individual billing profile", () => {
    expect(checkoutSchema.safeParse(validCheckout).success).toBe(true);
  });

  it.each(["business", "company", "organization"])(
    "rejects buyerType=%s",
    (buyerType) => {
      expect(
        checkoutSchema.safeParse({
          ...validCheckout,
          billing: { ...validCheckout.billing, buyerType },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    { companyName: "Minta Kft." },
    { taxNumber: "12345678-1-42" },
    { vatId: "HU12345678" },
    { euVatId: "HU12345678" },
  ])("rejects forbidden billing keys: %j", (forbidden) => {
    const payload = {
      ...validCheckout,
      billing: { ...validCheckout.billing, ...forbidden },
    };
    expect(checkoutSchema.safeParse(payload).success).toBe(false);
    expect(detectSuspiciousCheckoutInput(payload)).not.toBeNull();
  });

  it.each(["Minta Kft.", "Példa Bt", "Example LLC", "Teszt Egyéni Vállalkozó"])(
    "rejects an organization-like invoice name: %s",
    (name) => {
      expect(looksLikeBusinessName(name)).toBe(true);
      expect(
        checkoutSchema.safeParse({
          ...validCheckout,
          billing: { ...validCheckout.billing, name },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["price", 1],
    ["amount", 1],
    ["currency", "eur"],
    ["coupon", "FREE100"],
    ["discount", 890],
  ])("rejects frontend supplied pricing field %s", (key, value) => {
    const manipulated = { ...validCheckout, [key]: value };
    expect(checkoutSchema.safeParse(manipulated).success).toBe(false);
    expect(detectSuspiciousCheckoutInput(manipulated)).toBe("manipulated_price");
  });

  it("rejects missing billing details", () => {
    const { billing: _billing, ...withoutBilling } = validCheckout;
    expect(checkoutSchema.safeParse(withoutBilling).success).toBe(false);
  });

  it("rejects excessive nesting and cyclic objects without recursive overflow", () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let depth = 0; depth < 20; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(detectSuspiciousCheckoutInput(deeplyNested)).toBe("invalid_structure");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(detectSuspiciousCheckoutInput(cyclic)).toBe("invalid_structure");
  });

  it("rejects non-Hungarian billing while VAT rules are HU-only", () => {
    expect(
      checkoutSchema.safeParse({
        ...validCheckout,
        billing: { ...validCheckout.billing, country: "DE" },
      }).success,
    ).toBe(false);
  });

  it("accepts a Hungarian business buyer only with a valid tax number", () => {
    const businessCheckout = {
      ...validCheckout,
      billing: {
        buyerType: "business",
        name: "Minta Kft.",
        email: "szamla@minta.hu",
        country: "HU",
        postalCode: "1111",
        city: "Budapest",
        addressLine1: "Példa utca 1.",
        taxNumber: "12345678-1-42",
      },
    };
    expect(checkoutSchema.safeParse(businessCheckout).success).toBe(true);
    expect(detectSuspiciousCheckoutInput(businessCheckout)).toBeNull();
    expect(
      checkoutSchema.safeParse({
        ...businessCheckout,
        billing: { ...businessCheckout.billing, taxNumber: "" },
      }).success,
    ).toBe(false);
  });
});

describe("server-side price and AAM calculations", () => {
  it.each([
    ["basic", 890],
    ["premium", 3900],
    ["premium_plus", 10900],
  ] as const)("calculates %s exclusively from the package catalog", (packageId, amount) => {
    expect(calculateOrderPrice(packageId)).toEqual({
      packageId,
      grossAmount: amount,
      discountAmount: 0,
      payableAmount: amount,
      currency: "huf",
      vatCode: "AAM",
    });
  });

  it("uses equal net and gross amounts with zero VAT for AAM invoices", () => {
    expect(calculateAamInvoiceAmounts(890)).toEqual({
      netAmount: 890,
      vatAmount: 0,
      grossAmount: 890,
      vatCode: "AAM",
    });
    expect(calculateAamInvoiceAmounts(3900)).toEqual({
      netAmount: 3900,
      vatAmount: 0,
      grossAmount: 3900,
      vatCode: "AAM",
    });
  });

  it.each([0, -1, 12.5, Number.NaN])("rejects invalid payable amount %s", (amount) => {
    expect(() => calculateAamInvoiceAmounts(amount)).toThrow("INVALID_GROSS_AMOUNT");
  });
});

describe("Stripe Checkout request", () => {
  it("converts HUF checkout amounts to Stripe minor units without changing business amounts", () => {
    expect(toStripeMinorAmount(890, "huf")).toBe(89000);
    expect(fromStripeMinorAmount(89000, "huf")).toBe(890);
  });

  it("uses only server values in line items and keeps business data out of metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.test", status: "open" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await createCheckoutSession(
      {
        PAYMENT_MODE: "test",
        STRIPE_SECRET_KEY: "sk_test_fake",
        SITE_URL: "https://example.com",
      } as Env,
      {
        packageId: "basic",
        packageName: "Alapcsomag",
        amount: 890,
        currency: "huf",
        email: "szamla@example.com",
        orderId: "order_1",
        publicId: "public_1",
        resultToken: "result-token",
      },
    );

    const init = fetchSpy.mock.calls[0][1]!;
    const params = init.body as URLSearchParams;
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("89000");
    expect(params.get("line_items[0][price_data][currency]")).toBe("huf");
    expect(params.get("line_items[0][price_data][tax_behavior]")).toBeNull();
    expect(params.get("automatic_tax[enabled]")).toBeNull();
    expect(params.get("invoice_creation[enabled]")).toBeNull();
    expect(params.get("payment_method_types[0]")).toBe("card");
    const metadata = [...params.entries()].filter(([key]) => key.includes("metadata"));
    expect(metadata.map(([key]) => key).sort()).toEqual([
      "metadata[orderId]",
      "metadata[publicId]",
      "metadata[selectedPackage]",
      "payment_intent_data[metadata][orderId]",
      "payment_intent_data[metadata][selectedPackage]",
    ]);
    expect(JSON.stringify(metadata)).not.toMatch(/company|business|tax|vat/i);
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("checkout-order_1");
    expect((init.headers as Record<string, string>)["Stripe-Version"]).toBe("2026-02-25.clover");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const successUrl = new URL(params.get("success_url")!);
    const cancelUrl = new URL(params.get("cancel_url")!);
    expect(successUrl.searchParams.get("token")).toBeNull();
    expect(cancelUrl.searchParams.get("token")).toBeNull();
    expect(new URLSearchParams(successUrl.hash.slice(1)).get("token")).toBe("result-token");
    expect(new URLSearchParams(cancelUrl.hash.slice(1)).get("token")).toBe("result-token");
  });
});

describe("Szamlazz.hu invoice payload", () => {
  it("contains the full individual address and no company/tax/VAT identifier", () => {
    const order = orderFixture({ payment_status: "paid", paid_at: "2026-06-22T10:00:00.000Z" });
    const payload = buildSzamlazzPayload(order);
    expect(payload.netAmount + payload.vatAmount).toBe(payload.grossAmount);
    const xml = buildInvoiceXml("test-agent-key", payload);
    expect(xml).toContain("<nev>Teszt Elek</nev>");
    expect(xml).toContain("<orszag>HU</orszag>");
    expect(xml).toContain("<irsz>1111</irsz>");
    expect(xml).toContain("<adoalany>-1</adoalany>");
    expect(xml).toContain("<nettoEgysegar>890</nettoEgysegar>");
    expect(xml).toContain("<afakulcs>AAM</afakulcs>");
    expect(xml).toContain("<nettoErtek>890</nettoErtek>");
    expect(xml).toContain("<afaErtek>0</afaErtek>");
    expect(xml).toContain("<bruttoErtek>890</bruttoErtek>");
    expect(xml).not.toContain("<afakulcs>27</afakulcs>");
    expect(xml).not.toMatch(/<adoszam(?:EU)?>|<company|<cegnev|<vat/i);
  });

  it("includes the Hungarian tax number for a valid business invoice", () => {
    const order = orderFixture({
      payment_status: "paid",
      paid_at: "2026-06-22T10:00:00.000Z",
      billing_buyer_type: "business",
      billing_name: "Minta Kft.",
      billing_email: "szamla@minta.hu",
      billing_tax_number: "12345678-1-42",
    });
    const payload = buildSzamlazzPayload(order);
    expect(payload.buyerType).toBe("business");
    const xml = buildInvoiceXml("test-agent-key", payload, true);
    expect(xml).toContain("<nev>Minta Kft.</nev>");
    expect(xml).toContain("<adoszam>12345678-1-42</adoszam>");
    expect(xml).toContain("<afakulcs>AAM</afakulcs>");
    expect(xml).toContain("<afaErtek>0</afaErtek>");
    expect(xml).toContain("<sendEmail>true</sendEmail>");
    expect(xml).not.toContain("<adoalany>-1</adoalany>");
  });

  it("fails closed when required invoice delivery or business billing data is missing", () => {
    expect(() =>
      buildSzamlazzPayload(orderFixture({ billing_email: "" })),
    ).toThrowError(/Hiányzó számlázási email/);
    expect(() =>
      buildSzamlazzPayload(orderFixture({
        billing_buyer_type: "business",
        billing_name: "Minta Kft.",
        billing_tax_number: null,
      })),
    ).toThrowError(/Hiányzó céges adószám/);
  });

  it("uses the official invoice-create multipart field and parses official headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: {
          szlahu_szamlaszam: encodeURIComponent("E-TST-2026-1"),
          szlahu_vevoifiokurl: encodeURIComponent("https://www.szamlazz.hu/invoice/test"),
        },
      }),
    );
    const payload = buildSzamlazzPayload(
      orderFixture({ payment_status: "paid", paid_at: "2026-06-22T10:00:00.000Z" }),
    );
    const result = await issueSzamlazzInvoice(
      { PAYMENT_MODE: "test", SZAMLAZZ_AGENT_KEY: "test-agent-key" } as Env,
      payload,
    );
    expect(result.invoiceNumber).toBe("E-TST-2026-1");
    const form = fetchSpy.mock.calls[0][1]!.body as FormData;
    expect(form.get("action-xmlagentxmlfile")).toBeInstanceOf(Blob);
    expect(form.get("action-szamla_agent_xml")).toBeNull();
    const xml = await (form.get("action-xmlagentxmlfile") as Blob).text();
    expect(xml).not.toMatch(/<adoszam(?:EU)?>/i);
    expect(xml).toContain("<sendEmail>false</sendEmail>");
  });

  it("reconciles an ambiguous retry by external id before creating again", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<xmlszamla><szamlaszam>E-TST-2026-9</szamlaszam></xmlszamla>", {
        status: 200,
      }),
    );
    const payload = buildSzamlazzPayload(
      orderFixture({ payment_status: "paid", paid_at: "2026-06-22T10:00:00.000Z" }),
    );
    const result = await issueSzamlazzInvoice(
      { SZAMLAZZ_AGENT_KEY: "test-agent-key" } as Env,
      payload,
      true,
    );
    expect(result).toMatchObject({ invoiceNumber: "E-TST-2026-9", alreadyExisted: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const form = fetchSpy.mock.calls[0][1]!.body as FormData;
    expect(form.get("action-szamla_agent_xml")).toBeInstanceOf(Blob);
  });

  it("classifies provider 5xx as retryable without leaking the Agent key", async () => {
    const secret = "agent-key-must-not-leak";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private response", { status: 503 }));
    const payload = buildSzamlazzPayload(orderFixture({ payment_status: "paid" }));
    await expect(
      issueSzamlazzInvoice({ SZAMLAZZ_AGENT_KEY: secret } as Env, payload),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof InvoiceProviderError &&
        error.retryable &&
        !error.message.includes(secret) &&
        !error.message.includes("private response"),
    );
  });
});
