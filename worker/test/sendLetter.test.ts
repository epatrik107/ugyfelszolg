import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/lib/hash";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  getLetterEmailVersionKey: vi.fn(),
  getOrderByPublicId: vi.fn(),
  hasLetterEmailVersionSent: vi.fn(),
  markLetterEmailSent: vi.fn(),
  sendLetterReadyEmail: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getLetterEmailVersionKey: mocks.getLetterEmailVersionKey,
  getOrderByPublicId: mocks.getOrderByPublicId,
  hasLetterEmailVersionSent: mocks.hasLetterEmailVersionSent,
  markLetterEmailSent: mocks.markLetterEmailSent,
}));

vi.mock("../src/lib/email", () => ({
  sendLetterReadyEmail: mocks.sendLetterReadyEmail,
}));

vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: mocks.isRateLimited,
}));

const { sendLetterRoute } = await import("../src/routes/sendLetter");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/orders/:publicId/send-letter", sendLetterRoute);
  return instance;
}

async function request(body: unknown = {}, token = "owner-token") {
  return app().fetch(
    new Request("https://worker.test/orders/public_1/send-letter", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { TOKEN_HASH_SECRET: "token-secret", SITE_URL: "https://example.com" } as Env,
  );
}

describe("sendLetter route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.getLetterEmailVersionKey.mockResolvedValue("sha256:abcdef1234567890");
    mocks.hasLetterEmailVersionSent.mockReturnValue(false);
    mocks.sendLetterReadyEmail.mockResolvedValue({ providerMessageId: "email_1" });
    mocks.getOrderByPublicId.mockResolvedValue(
      orderFixture({
        result_token_hash: await hashToken("owner-token", "token-secret"),
        payment_status: "paid",
        ai_status: "completed",
        generated_letter: "Aktuális levél",
        letter_history: JSON.stringify(["Első verzió"]),
      }),
    );
  });

  it("sends the selected version once and records the version hash", async () => {
    const response = await request({ versionIndex: 0 });

    expect(response.status).toBe(200);
    expect(mocks.sendLetterReadyEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "order_1" }),
      "Első verzió",
      "owner-token",
      "v-abcdef1234567890",
    );
    expect(mocks.markLetterEmailSent).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "sha256:abcdef1234567890",
    );
  });

  it("short-circuits duplicate sends for the same letter version", async () => {
    mocks.hasLetterEmailVersionSent.mockReturnValue(true);

    const response = await request();
    const payload = await response.json() as { data: { alreadySent?: boolean } };

    expect(response.status).toBe(200);
    expect(payload.data.alreadySent).toBe(true);
    expect(mocks.sendLetterReadyEmail).not.toHaveBeenCalled();
  });

  it("rejects invalid version payloads and wrong tokens", async () => {
    expect((await request({ versionIndex: -1 })).status).toBe(400);
    expect((await request({}, "wrong-token")).status).toBe(401);
  });
});
