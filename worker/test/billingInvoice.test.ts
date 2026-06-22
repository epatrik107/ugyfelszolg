import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateHufB2cVat,
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
import { createCheckoutSession } from "../src/lib/stripe";
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

describe("B2C checkout validation", () => {
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

  it("rejects non-Hungarian billing while VAT rules are HU-only", () => {
    expect(
      checkoutSchema.safeParse({
        ...validCheckout,
        billing: { ...validCheckout.billing, country: "DE" },
      }).success,
    ).toBe(false);
  });
});

describe("server-side price and VAT calculations", () => {
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
      vatRate: 27,
    });
  });

  it("uses documented gross-based whole-HUF B2C rounding", () => {
    expect(calculateHufB2cVat(890)).toEqual({
      netAmount: 701,
      vatAmount: 189,
      grossAmount: 890,
      vatRate: 27,
    });
    expect(calculateHufB2cVat(3900)).toEqual({
      netAmount: 3071,
      vatAmount: 829,
      grossAmount: 3900,
      vatRate: 27,
    });
  });

  it.each([0, -1, 12.5, Number.NaN])("rejects invalid payable amount %s", (amount) => {
    expect(() => calculateHufB2cVat(amount)).toThrow("INVALID_GROSS_AMOUNT");
  });
});

describe("Stripe Checkout request", () => {
  it("uses only server values in line items and keeps business data out of metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.test", status: "open" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await createCheckoutSession(
      { STRIPE_SECRET_KEY: "sk_test_fake", SITE_URL: "https://example.com" } as Env,
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
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("890");
    expect(params.get("line_items[0][price_data][currency]")).toBe("huf");
    expect(params.get("line_items[0][price_data][tax_behavior]")).toBe("inclusive");
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
  });
});

describe("Szamlazz.hu B2C payload", () => {
  it("contains the full individual address and no company/tax/VAT identifier", () => {
    const order = orderFixture({ payment_status: "paid", paid_at: "2026-06-22T10:00:00.000Z" });
    const payload = buildSzamlazzPayload(order);
    expect(payload.netAmount + payload.vatAmount).toBe(payload.grossAmount);
    const xml = buildInvoiceXml("test-agent-key", payload);
    expect(xml).toContain("<nev>Teszt Elek</nev>");
    expect(xml).toContain("<orszag>HU</orszag>");
    expect(xml).toContain("<irsz>1111</irsz>");
    expect(xml).toContain("<adoalany>-1</adoalany>");
    expect(xml).toContain("<nettoErtek>701</nettoErtek>");
    expect(xml).toContain("<afaErtek>189</afaErtek>");
    expect(xml).toContain("<bruttoErtek>890</bruttoErtek>");
    expect(xml).not.toMatch(/<adoszam(?:EU)?>|<company|<cegnev|<vat/i);
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
      { SZAMLAZZ_AGENT_KEY: "test-agent-key" } as Env,
      payload,
    );
    expect(result.invoiceNumber).toBe("E-TST-2026-1");
    const form = fetchSpy.mock.calls[0][1]!.body as FormData;
    expect(form.get("action-xmlagentxmlfile")).toBeInstanceOf(Blob);
    expect(form.get("action-szamla_agent_xml")).toBeNull();
    const xml = await (form.get("action-xmlagentxmlfile") as Blob).text();
    expect(xml).not.toMatch(/<adoszam(?:EU)?>/i);
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
