import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/lib/hash";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  beginRegeneration: vi.fn(),
  getOrderByPublicId: vi.fn(),
  generateLetterForPaidOrder: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  beginRegeneration: mocks.beginRegeneration,
  getOrderByPublicId: mocks.getOrderByPublicId,
}));

vi.mock("../src/lib/ai", () => ({
  generateLetterForPaidOrder: mocks.generateLetterForPaidOrder,
}));

vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: mocks.isRateLimited,
}));

const { regenerateOrderRoute } = await import("../src/routes/regenerateOrder");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/orders/:publicId/regenerate", regenerateOrderRoute);
  return instance;
}

async function request(body: unknown, token = "owner-token", waitUntil = vi.fn()) {
  const response = await app().fetch(
    new Request("https://worker.test/orders/public_1/regenerate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { TOKEN_HASH_SECRET: "token-secret" } as Env,
    { waitUntil } as unknown as ExecutionContext,
  );
  return { response, waitUntil };
}

describe("regenerateOrder route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.beginRegeneration.mockResolvedValue(true);
    const completedOrder = orderFixture({
      result_token_hash: await hashToken("owner-token", "token-secret"),
      payment_status: "paid",
      ai_status: "completed",
      generated_letter: "Első verzió",
      generation_count: 1,
      selected_package: "premium",
    });
    mocks.getOrderByPublicId
      .mockResolvedValueOnce(completedOrder)
      .mockResolvedValueOnce({ ...completedOrder, ai_status: "generating", generation_count: 2 });
  });

  it("authenticates, atomically starts regeneration, and schedules generation", async () => {
    const { response, waitUntil } = await request({ feedback: "Legyen rövidebb és tárgyilagosabb." });

    expect(response.status).toBe(200);
    expect(mocks.beginRegeneration).toHaveBeenCalledWith(expect.anything(), "order_1", 3);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(mocks.generateLetterForPaidOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ generation_count: 2 }),
      "Legyen rövidebb és tárgyilagosabb.",
    );
  });

  it("rejects invalid feedback before loading the order", async () => {
    const { response } = await request({ feedback: "   " });

    expect(response.status).toBe(400);
    expect(mocks.getOrderByPublicId).not.toHaveBeenCalled();
  });

  it("rejects wrong tokens and exhausted regeneration state", async () => {
    expect((await request({ feedback: "Legyen rövidebb." }, "wrong-token")).response.status).toBe(401);

    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.getOrderByPublicId.mockResolvedValue(
      orderFixture({
        result_token_hash: await hashToken("owner-token", "token-secret"),
        payment_status: "paid",
        ai_status: "completed",
        generation_count: 4,
        selected_package: "premium",
      }),
    );
    expect((await request({ feedback: "Legyen rövidebb." })).response.status).toBe(409);
    expect(mocks.beginRegeneration).not.toHaveBeenCalled();
  });
});
