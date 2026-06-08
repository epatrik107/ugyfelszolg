import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAiServiceAvailable } from "../src/lib/health";
import { createCheckoutSessionRoute } from "../src/routes/createCheckoutSession";
import type { Env } from "../src/lib/types";

vi.mock("../src/lib/ai", () => ({
  generateLetterForPaidOrder: vi.fn(async () => {}),
}));

vi.mock("../src/lib/db", () => ({
  attachStripeSession: vi.fn(async () => {}),
  beginGeneration: vi.fn(async () => true),
  getOrderById: vi.fn(async () => ({ id: "order_1" })),
  insertOrder: vi.fn(async () => {}),
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
});
