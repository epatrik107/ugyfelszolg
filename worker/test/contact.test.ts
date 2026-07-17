import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/types";

const mocks = vi.hoisted(() => ({
  insertContactMessage: vi.fn(),
  isRateLimited: vi.fn(),
  verifyTurnstileToken: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  insertContactMessage: mocks.insertContactMessage,
}));

vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: mocks.isRateLimited,
}));

vi.mock("../src/lib/turnstile", () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

const { contactRoute } = await import("../src/routes/contact");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/contact", contactRoute);
  return instance;
}

const validPayload = {
  name: "Teszt Elek",
  email: "TESZT@example.com",
  message: "Szeretnék segítséget kérni az ügyemben.",
  turnstileToken: "turnstile-token",
};

async function request(body: unknown) {
  return app().fetch(
    new Request("https://worker.test/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    {} as Env,
  );
}

describe("contact route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.verifyTurnstileToken.mockResolvedValue(true);
  });

  it("validates Turnstile, lowercases email, and stores a strict contact message", async () => {
    const response = await request(validPayload);

    expect(response.status).toBe(200);
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith(
      expect.anything(),
      "turnstile-token",
      "127.0.0.1",
      "contact",
    );
    expect(mocks.insertContactMessage).toHaveBeenCalledWith(expect.anything(), {
      name: "Teszt Elek",
      email: "teszt@example.com",
      message: "Szeretnék segítséget kérni az ügyemben.",
    });
  });

  it("rejects extra fields, rate limits, and failed Turnstile checks", async () => {
    expect((await request({ ...validPayload, unexpected: true })).status).toBe(400);
    expect(mocks.insertContactMessage).not.toHaveBeenCalled();

    mocks.isRateLimited.mockResolvedValueOnce(true);
    expect((await request(validPayload)).status).toBe(429);

    mocks.isRateLimited.mockResolvedValue(false);
    mocks.verifyTurnstileToken.mockResolvedValue(false);
    expect((await request(validPayload)).status).toBe(400);
  });
});
