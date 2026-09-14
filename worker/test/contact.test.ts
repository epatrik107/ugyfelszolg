import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/types";
import { sqliteEnv } from "./helpers/sqlite";

const mocks = vi.hoisted(() => ({
  isRateLimited: vi.fn(),
  verifyTurnstileToken: vi.fn(),
}));

vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: mocks.isRateLimited,
}));

vi.mock("../src/lib/turnstile", () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

const { contactRoute } = await import("../src/routes/contact");

const validPayload = {
  name: "Teszt Elek",
  email: "TESZT@example.com",
  message: "Szeretnék segítséget kérni az ügyemben.",
  turnstileToken: "turnstile-token",
};

async function request(env: Env, body: unknown) {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/contact", contactRoute);
  return instance.fetch(
    new Request("https://worker.test/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("contact route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.verifyTurnstileToken.mockResolvedValue(true);
  });

  it("validates Turnstile, stores the message and queues an operator notification atomically", async () => {
    const { env, sqlite } = sqliteEnv();
    const response = await request(env, validPayload);

    expect(response.status).toBe(200);
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith(expect.anything(), "turnstile-token", "127.0.0.1", "contact");
    const message = sqlite.prepare("SELECT id, name, email, message FROM contact_messages").get() as Record<string, string>;
    expect(message).toMatchObject({ name: "Teszt Elek", email: "teszt@example.com", message: validPayload.message });
    const outbox = sqlite.prepare("SELECT kind, dedupe_key, payload, status FROM email_outbox").all() as Array<Record<string, string>>;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: "contact_notification", dedupe_key: `contact:${message.id}`, status: "pending" });
    expect(JSON.parse(outbox[0].payload)).toMatchObject({ email: "teszt@example.com", message: validPayload.message });
    sqlite.close();
  });

  it("rejects extra fields, rate limits, and failed Turnstile checks without storing anything", async () => {
    const { env, sqlite } = sqliteEnv();
    expect((await request(env, { ...validPayload, unexpected: true })).status).toBe(400);

    mocks.isRateLimited.mockResolvedValueOnce(true);
    expect((await request(env, validPayload)).status).toBe(429);

    mocks.isRateLimited.mockResolvedValue(false);
    mocks.verifyTurnstileToken.mockResolvedValue(false);
    expect((await request(env, validPayload)).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM contact_messages").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM email_outbox").get()).toEqual({ n: 0 });
    sqlite.close();
  });
});
