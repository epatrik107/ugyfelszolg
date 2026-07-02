import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAiServiceAvailable } from "../src/lib/health";
import { getOrderByCheckoutIdempotencyKey } from "../src/lib/db";
import { hashToken } from "../src/lib/hash";
import { createCheckoutSession as createStripeCheckoutSession } from "../src/lib/stripe";
import { retrieveCheckoutSession } from "../src/lib/stripe";
import { createCheckoutSessionRoute } from "../src/routes/createCheckoutSession";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

vi.mock("../src/lib/ai", () => ({
  generateLetterForPaidOrder: vi.fn(async () => {}),
}));

vi.mock("../src/lib/db", () => ({
  attachStripeSession: vi.fn(async () => true),
  beginGeneration: vi.fn(async () => true),
  getOrderByCheckoutIdempotencyKey: vi.fn(async () => null),
  getOrderById: vi.fn(async () => ({ id: "order_1" })),
  insertOrder: vi.fn(async () => true),
}));

vi.mock("../src/lib/health", () => ({
  checkAiServiceAvailable: vi.fn(async () => false),
}));

vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: vi.fn(async () => false),
}));

vi.mock("../src/lib/stripe", () => ({
  createCheckoutSession: vi.fn(async () => ({ id: "session_1", url: "https://stripe.test" })),
  retrieveCheckoutSession: vi.fn(),
}));

vi.mock("../src/lib/turnstile", () => ({
  verifyTurnstileToken: vi.fn(async () => true),
}));

const payload = {
  name: "Patrik",
  email: "patrik@example.com",
  letterType: "Panaszlevél",
  recipient: "Zalando support",
  problemDescription: "Két hete rendeltem egy terméket, de még mindig nem érkezett meg.",
  desiredResult: "Kérem vissza a pénzem.",
  tone: "Udvarias",
  previousMessages: "",
  selectedPackage: "premium",
  checkoutAttemptId: "84c31d7f-0c7c-4bf8-85e5-fcd6a0949681",
  billing: {
    buyerType: "individual",
    name: "Patrik Engelbrecht",
    email: "patrik@example.com",
    country: "HU",
    postalCode: "1111",
    city: "Budapest",
    addressLine1: "Példa utca 1.",
  },
  legalAccepted: true,
  turnstileToken: "turnstile-token",
  demoAccessCode: "demo-code",
};

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/", createCheckoutSessionRoute);
  return instance;
}

function env(overrides: Partial<Env> = {}) {
  return {
    DEMO_MODE: "true",
    PAYMENTS_ENABLED: "false",
    DEMO_ACCESS_CODE: "demo-code",
    TOKEN_HASH_SECRET: "token-secret",
    SITE_URL: "https://example.com",
    ...overrides,
  } as Env;
}

describe("checkout AI availability preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAiServiceAvailable).mockResolvedValue(false);
    vi.mocked(getOrderByCheckoutIdempotencyKey).mockResolvedValue(null);
  });

  it("does not block a valid demo request when AI metadata preflight fails", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      env(),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(checkAiServiceAvailable).not.toHaveBeenCalled();
  });

  it("does not allow demo-code payment bypass when payments are enabled", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      env({ DEMO_MODE: "true", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(503);
    expect(checkAiServiceAvailable).toHaveBeenCalledWith(expect.anything(), true);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it("still blocks a paid checkout before charging when AI preflight fails", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, demoAccessCode: "" }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(503);
    expect(checkAiServiceAvailable).toHaveBeenCalledWith(expect.anything(), true);
  });

  it.each([
    ["company name", { billing: { ...payload.billing, companyName: "Minta Kft." } }],
    ["tax number", { billing: { ...payload.billing, taxNumber: "12345678-1-42" } }],
    ["VAT ID", { billing: { ...payload.billing, vatId: "HU12345678" } }],
    ["business buyer", { billing: { ...payload.billing, buyerType: "business" } }],
    ["company buyer", { billing: { ...payload.billing, buyerType: "company" } }],
    ["organization buyer", { billing: { ...payload.billing, buyerType: "organization" } }],
  ])("blocks %s before Stripe is called", async (_label, override) => {
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...override }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it("blocks an organization-like billing name before Stripe is called", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          billing: { ...payload.billing, name: "Minta Kft." },
        }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects a manipulated frontend price before Stripe is called", async () => {
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, price: 1 }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    ["basic", 890],
    ["premium", 3900],
    ["premium_plus", 10900],
  ] as const)(
    "uses the server catalog price and individual billing email for %s checkout",
    async (selectedPackage, amount) => {
      vi.mocked(checkAiServiceAvailable).mockResolvedValue(true);
      const response = await app().fetch(
        new Request("https://worker.test/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, selectedPackage }),
        }),
        env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );
      expect(response.status).toBe(200);
      expect(createStripeCheckoutSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          packageId: selectedPackage,
          amount,
          currency: "huf",
          email: "patrik@example.com",
        }),
      );
    },
  );

  it("does not start a second payment for an already paid idempotent order", async () => {
    const fingerprint = await hashToken(
      JSON.stringify({
        name: payload.name,
        email: payload.email,
        letterType: payload.letterType,
        recipient: payload.recipient,
        problemDescription: payload.problemDescription,
        desiredResult: payload.desiredResult,
        tone: payload.tone,
        previousMessages: payload.previousMessages,
        selectedPackage: payload.selectedPackage,
        billing: payload.billing,
      }),
      "token-secret",
    );
    vi.mocked(getOrderByCheckoutIdempotencyKey).mockResolvedValue(
      orderFixture({ payment_status: "paid", checkout_input_hash: fingerprint }),
    );
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, demoAccessCode: "" }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(409);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with different order data", async () => {
    vi.mocked(getOrderByCheckoutIdempotencyKey).mockResolvedValue(
      orderFixture({ checkout_input_hash: "different-input-hash" }),
    );
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, demoAccessCode: "" }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(409);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it("reuses the same open Stripe session for an identical client retry", async () => {
    const fingerprint = await hashToken(
      JSON.stringify({
        name: payload.name,
        email: payload.email,
        letterType: payload.letterType,
        recipient: payload.recipient,
        problemDescription: payload.problemDescription,
        desiredResult: payload.desiredResult,
        tone: payload.tone,
        previousMessages: payload.previousMessages,
        selectedPackage: payload.selectedPackage,
        billing: payload.billing,
      }),
      "token-secret",
    );
    vi.mocked(getOrderByCheckoutIdempotencyKey).mockResolvedValue(
      orderFixture({ checkout_input_hash: fingerprint, payment_status: "checkout_created" }),
    );
    vi.mocked(retrieveCheckoutSession).mockResolvedValue({
      id: "cs_test_1",
      url: "https://stripe.test/reused",
      status: "open",
    } as never);
    const response = await app().fetch(
      new Request("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, demoAccessCode: "" }),
      }),
      env({ DEMO_MODE: "false", PAYMENTS_ENABLED: "true" }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(createStripeCheckoutSession).not.toHaveBeenCalled();
  });
});
