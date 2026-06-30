import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/lib/hash";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  getOrderByPublicId: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getOrderByPublicId: mocks.getOrderByPublicId,
}));

vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: mocks.isRateLimited,
}));

const { getOrderResultRoute } = await import("../src/routes/getOrderResult");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.get("/orders/:publicId/result", getOrderResultRoute);
  return instance;
}

async function request(token?: string) {
  return app().fetch(
    new Request(`https://worker.test/orders/public_1/result${token ? `?token=${token}` : ""}`),
    { TOKEN_HASH_SECRET: "token-secret" } as Env,
  );
}

describe("getOrderResult route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.getOrderByPublicId.mockResolvedValue(
      orderFixture({
        result_token_hash: await hashToken("owner-token", "token-secret"),
        payment_status: "paid",
        ai_status: "completed",
        generated_letter: "Tárgy: Panasz\n\nKész levél.",
        letter_history: JSON.stringify(["Korábbi verzió"]),
      }),
    );
  });

  it("returns a completed letter only with the correct token", async () => {
    const response = await request("owner-token");
    const payload = await response.json() as { data: { generatedLetter?: string; letterHistory: string[] } };

    expect(response.status).toBe(200);
    expect(payload.data.generatedLetter).toContain("Kész levél");
    expect(payload.data.letterHistory).toEqual(["Korábbi verzió"]);
  });

  it("rejects missing or wrong tokens", async () => {
    expect((await request()).status).toBe(401);
    expect((await request("wrong-token")).status).toBe(401);
  });

  it("does not expose the letter while generation is not completed", async () => {
    mocks.getOrderByPublicId.mockResolvedValue(
      orderFixture({
        result_token_hash: await hashToken("owner-token", "token-secret"),
        payment_status: "paid",
        ai_status: "generating",
        generated_letter: "Nem küldhető még.",
      }),
    );

    const response = await request("owner-token");
    const payload = await response.json() as { data: { generatedLetter?: string } };
    expect(response.status).toBe(200);
    expect(payload.data.generatedLetter).toBeUndefined();
  });

  it("applies result rate limiting before token lookup", async () => {
    mocks.isRateLimited.mockResolvedValue(true);
    const response = await request("owner-token");

    expect(response.status).toBe(429);
    expect(mocks.getOrderByPublicId).not.toHaveBeenCalled();
  });
});
