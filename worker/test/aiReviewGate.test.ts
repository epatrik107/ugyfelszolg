import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_REVIEW_UNAVAILABLE_MESSAGE,
  generateLetterForPaidOrder,
} from "../src/lib/ai";
import {
  completeGeneration,
  failGeneration,
  commitReservedQuota,
  markLetterEmailSent,
} from "../src/lib/db";
import { createRefund } from "../src/lib/stripe";
import type { Env, OrderRow } from "../src/lib/types";

vi.mock("../src/lib/db", () => ({
  commitReservedQuota: vi.fn(),
  completeGeneration: vi.fn(),
  failGeneration: vi.fn(),
  getLetterEmailVersionKey: vi.fn(async () => "sha256:test-letter"),
  hasLetterEmailVersionSent: vi.fn(() => false),
  markLetterEmailSent: vi.fn(),
  markOrderPaymentStatus: vi.fn(),
  upsertPaymentRefund: vi.fn(),
  markRefundInvoiceManualRequired: vi.fn(),
}));

vi.mock("../src/lib/email", () => ({
  sendGeneratedLetterEmail: vi.fn(),
  sendRefundEmail: vi.fn(),
}));

vi.mock("../src/lib/invoice", () => ({
  getInvoiceByOrderId: vi.fn(),
}));

vi.mock("../src/lib/stripe", () => ({
  createRefund: vi.fn(),
  normalizeStripeRefundStatus: (status: string) => status,
  fromStripeMinorAmount: vi.fn((amount: number | null, currency: string | null) => {
    if (amount === null || currency === null) return null;
    return currency.toLowerCase() === "huf" ? amount / 100 : amount;
  }),
}));

const safeLetter = `Tárgy: Reklamáció hibás szolgáltatás miatt

Tisztelt Ügyfélszolgálat!

Kérem, szíveskedjenek kivizsgálni az ügyet, mert a szolgáltatás nem a megbeszéltek szerint működött.

Kérem, hogy a hiba javításáról és a további teendőkről írásban tájékoztassanak.

Előre is köszönöm szíves együttműködésüket.

Tisztelettel:
Teszt Felhasználó`;

const env = {
  GEMINI_API_KEY: "fake-gemini-key-for-tests",
  GEMINI_MODEL: "gemini-test",
  GEMINI_REVIEW_MODEL: "gemini-review-test",
} as unknown as Env;

const order: OrderRow = {
  id: "order_1",
  public_id: "public_1",
  result_token_hash: "hash",
  email: "test@example.com",
  name: "Teszt Elek",
  letter_type: "Panaszlevél",
  recipient: "Ügyfélszolgálat",
  problem_description: "A szolgáltatás nem működött megfelelően.",
  desired_result: "Kérem a hiba javítását.",
  tone: "Udvarias",
  previous_messages: null,
  selected_package: "basic",
  server_calculated_price: 890,
  currency: "HUF",
  payment_status: "paid",
  ai_status: "generating",
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  generated_letter: null,
  generation_count: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  paid_at: "2026-01-01T00:00:00.000Z",
  generated_at: null,
  error_message: null,
  subscription_id: null,
  billing_source: "checkout",
  letter_history: null,
  letter_email_sent: 0,
  checkout_idempotency_key: null,
  checkout_input_hash: null,
  paid_amount: 890,
  customer_email: "test@example.com",
  billing_buyer_type: "individual",
  billing_name: "Teszt Elek",
  billing_email: "test@example.com",
  billing_country: "HU",
  billing_postal_code: "1111",
  billing_city: "Budapest",
  billing_address_line1: "Példa utca 1.",
  billing_tax_number: null,
  invoice_status: "created",
  invoice_provider: "internal",
  invoice_number: "TEST-2026-000001",
  invoice_external_id: "order_1",
  invoice_pdf_url: null,
  szamlazz_invoice_id: null,
  szamlazz_invoice_number: null,
  invoice_sent_to_email: null,
  invoice_sent_at: null,
  invoice_created_at: "2026-01-01T00:00:00.000Z",
  invoice_email_status: "pending",
  invoice_email_error_message: null,
  invoice_error_code: null,
  invoice_error_message: null,
  invoice_retry_count: 1,
  invoice_last_attempted_at: null,
  invoice_next_retry_at: null,
  invoiced_at: "2026-01-01T00:00:00.000Z",
  refund_invoice_status: "not_required",
  refund_amount: null,
  refund_stripe_id: null,
  stripe_refund_status: null,
  stripe_refund_failure_reason: null,
  letter_email_sent_versions: null,
  personal_data_redacted_at: null,
  legal_accepted_at: "2026-01-01T00:00:00.000Z",
  legal_terms_version: "2026-07-14",
  privacy_policy_version: "2026-07-14",
};

function geminiResponse(text: string) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function reviewResponse(payload: unknown) {
  return geminiResponse(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function fetchMock(...values: Array<Response | Error | DOMException>) {
  const mock = vi.fn();
  for (const value of values) {
    if (value instanceof Error || value instanceof DOMException) {
      mock.mockRejectedValueOnce(value);
    } else {
      mock.mockResolvedValueOnce(value);
    }
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("secondary AI review gate", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(completeGeneration).mockResolvedValue(true);
    vi.mocked(failGeneration).mockResolvedValue(true);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleSpy.mockRestore();
  });

  it("allows generation after a timeout followed by a successful review retry", async () => {
    const fetch = fetchMock(
      geminiResponse(safeLetter),
      new DOMException("timed out", "TimeoutError"),
      reviewResponse({ ok: true, issues: [] }),
    );

    await generateLetterForPaidOrder(env, order);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(completeGeneration).toHaveBeenCalledWith(env, order.id, safeLetter, null);
    expect(failGeneration).not.toHaveBeenCalled();
  });

  it("blocks generation after repeated review timeouts", async () => {
    fetchMock(
      geminiResponse(safeLetter),
      new DOMException("timed out", "TimeoutError"),
      new DOMException("timed out again", "TimeoutError"),
    );

    await generateLetterForPaidOrder(env, order);

    expect(completeGeneration).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      null,
    );
  });

  it("blocks generation after retryable review HTTP errors exceed the retry limit", async () => {
    fetchMock(
      geminiResponse(safeLetter),
      new Response(null, { status: 500 }),
      new Response(null, { status: 429 }),
    );

    await generateLetterForPaidOrder(env, order);

    expect(completeGeneration).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      null,
    );
  });

  it("blocks malformed review JSON without retrying", async () => {
    const fetch = fetchMock(geminiResponse(safeLetter), reviewResponse("{not json"));

    await generateLetterForPaidOrder(env, order);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(completeGeneration).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      null,
    );
  });

  it("blocks incomplete or schema-invalid review JSON", async () => {
    fetchMock(geminiResponse(safeLetter), reviewResponse({ ok: true }));

    await generateLetterForPaidOrder(env, order);

    expect(completeGeneration).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      null,
    );
  });

  it("allows generation when review output is valid and approving", async () => {
    fetchMock(geminiResponse(safeLetter), reviewResponse({ ok: true, issues: [] }));

    await generateLetterForPaidOrder(env, order);

    expect(completeGeneration).toHaveBeenCalledWith(env, order.id, safeLetter, null);
    expect(failGeneration).not.toHaveBeenCalled();
  });

  it("emails the generated letter after successful generation when email is configured", async () => {
    const { sendGeneratedLetterEmail } = await import("../src/lib/email");
    fetchMock(geminiResponse(safeLetter), reviewResponse({ ok: true, issues: [] }));

    await generateLetterForPaidOrder(
      {
        ...env,
        SITE_URL: "https://example.com",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Sandbox <noreply@example.com>",
      },
      order,
    );

    expect(completeGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Sandbox <noreply@example.com>",
      }),
      order.id,
      safeLetter,
      null,
    );
    expect(sendGeneratedLetterEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: order.id, email: order.email }),
      safeLetter,
    );
    expect(markLetterEmailSent).toHaveBeenCalledWith(
      expect.anything(),
      order.id,
      "sha256:test-letter",
    );
  });

  it("does not send email or commit quota if completion lost the state race", async () => {
    const { sendGeneratedLetterEmail } = await import("../src/lib/email");
    vi.mocked(completeGeneration).mockResolvedValueOnce(false);
    fetchMock(geminiResponse(safeLetter), reviewResponse({ ok: true, issues: [] }));

    await generateLetterForPaidOrder(
      {
        ...env,
        SITE_URL: "https://example.com",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Sandbox <noreply@example.com>",
      },
      {
        ...order,
        subscription_id: "sub_1",
        billing_source: "subscription",
      },
    );

    expect(completeGeneration).toHaveBeenCalledWith(expect.anything(), order.id, safeLetter, null);
    expect(commitReservedQuota).not.toHaveBeenCalled();
    expect(sendGeneratedLetterEmail).not.toHaveBeenCalled();
    expect(markLetterEmailSent).not.toHaveBeenCalled();
  });

  it("does not fail generation when generated letter email delivery fails", async () => {
    const { sendGeneratedLetterEmail } = await import("../src/lib/email");
    vi.mocked(sendGeneratedLetterEmail).mockRejectedValue(new Error("Resend API error (500)"));
    fetchMock(geminiResponse(safeLetter), reviewResponse({ ok: true, issues: [] }));

    await generateLetterForPaidOrder(
      {
        ...env,
        SITE_URL: "https://example.com",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Sandbox <noreply@example.com>",
      },
      order,
    );

    expect(completeGeneration).toHaveBeenCalled();
    expect(failGeneration).not.toHaveBeenCalled();
    expect(markLetterEmailSent).not.toHaveBeenCalled();
  });

  it("prevents completion when valid review output blocks both generation attempts", async () => {
    fetchMock(
      geminiResponse(safeLetter),
      reviewResponse({ ok: false, issues: ["Személyes adat: private@example.com"] }),
      geminiResponse(safeLetter),
      reviewResponse({ ok: false, issues: ["Személyes adat: private@example.com"] }),
    );

    await generateLetterForPaidOrder(env, order);

    expect(completeGeneration).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      "Automatikus minőségellenőrzés sikertelen.",
      null,
    );
    expect(consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
      "private@example.com",
    );
  });

  it("persists generic errors and does not log provider details or secrets", async () => {
    const providerBody = "provider detail with secret sk_test_should_not_appear";
    fetchMock(
      geminiResponse(safeLetter),
      new Response(providerBody, { status: 503 }),
      new Response(providerBody, { status: 503 }),
    );

    await generateLetterForPaidOrder(env, order);

    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      null,
    );
    const persistedError = vi.mocked(failGeneration).mock.calls[0][3];
    expect(persistedError).not.toContain(providerBody);
    expect(persistedError).not.toContain(env.GEMINI_API_KEY);
    expect(consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
      providerBody,
    );
    expect(consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
      env.GEMINI_API_KEY,
    );
  });

  it("releases reserved quota on review gate failure for subscription orders", async () => {
    fetchMock(
      geminiResponse(safeLetter),
      new DOMException("timed out", "TimeoutError"),
      new DOMException("timed out again", "TimeoutError"),
    );

    await generateLetterForPaidOrder(env, {
      ...order,
      subscription_id: "sub_1",
      billing_source: "subscription",
    });

    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      "sub_1",
    );
    expect(commitReservedQuota).not.toHaveBeenCalled();
  });

  it("does not auto-refund if failure persistence lost the state race", async () => {
    vi.mocked(failGeneration).mockResolvedValueOnce(false);
    fetchMock(
      geminiResponse(safeLetter),
      new DOMException("timed out", "TimeoutError"),
      new DOMException("timed out again", "TimeoutError"),
    );

    await generateLetterForPaidOrder(env, {
      ...order,
      stripe_payment_intent_id: "pi_test_1",
      billing_source: "checkout",
    });

    expect(failGeneration).toHaveBeenCalledWith(
      env,
      order.id,
      "failed_review",
      AI_REVIEW_UNAVAILABLE_MESSAGE,
      null,
    );
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("records a pending automatic refund without claiming success or emailing it", async () => {
    const { markOrderPaymentStatus, upsertPaymentRefund } = await import("../src/lib/db");
    const { sendRefundEmail } = await import("../src/lib/email");
    vi.mocked(createRefund).mockResolvedValueOnce({
      id: "re_pending",
      payment_intent: "pi_test_1",
      amount: 89000,
      currency: "huf",
      status: "pending",
    });
    fetchMock(
      geminiResponse(safeLetter),
      new DOMException("timed out", "TimeoutError"),
      new DOMException("timed out again", "TimeoutError"),
    );

    await generateLetterForPaidOrder(env, {
      ...order,
      stripe_payment_intent_id: "pi_test_1",
      billing_source: "checkout",
    });

    expect(upsertPaymentRefund).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ stripeRefundId: "re_pending", status: "pending" }),
    );
    expect(markOrderPaymentStatus).not.toHaveBeenCalledWith(
      env,
      order.id,
      "refunded",
      expect.anything(),
    );
    expect(sendRefundEmail).not.toHaveBeenCalled();
  });
});
