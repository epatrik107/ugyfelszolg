import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/lib/hash";
import type { Env } from "../src/lib/types";
import { orderFixture } from "./fixtures";

const mocks = vi.hoisted(() => ({
  getOrderByPublicId: vi.fn(),
  markOrderPaymentStatus: vi.fn(),
  expireCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getOrderByPublicId: mocks.getOrderByPublicId,
  markOrderPaymentStatus: mocks.markOrderPaymentStatus,
}));
vi.mock("../src/lib/stripe", () => ({
  expireCheckoutSession: mocks.expireCheckoutSession,
  retrieveCheckoutSession: mocks.retrieveCheckoutSession,
}));
vi.mock("../src/lib/rateLimit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  isRateLimited: mocks.isRateLimited,
}));

const { cancelCheckoutSessionRoute } = await import("../src/routes/cancelCheckoutSession");

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.post("/orders/:publicId/cancel", cancelCheckoutSessionRoute);
  return instance;
}

async function request(token: string) {
  return app().fetch(
    new Request("https://worker.test/orders/public_1/cancel", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }),
    { TOKEN_HASH_SECRET: "token-secret" } as Env,
  );
}

describe("authenticated Checkout cancellation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockResolvedValue(false);
    mocks.markOrderPaymentStatus.mockResolvedValue(true);
    mocks.expireCheckoutSession.mockResolvedValue({ status: "expired" });
    mocks.retrieveCheckoutSession.mockResolvedValue({
      id: "cs_test_1",
      status: "open",
      payment_status: "unpaid",
    });
    mocks.getOrderByPublicId.mockResolvedValue(
      orderFixture({ result_token_hash: await hashToken("owner-token", "token-secret") }),
    );
  });

  it("expires the Stripe session before marking the order cancelled", async () => {
    const response = await request("owner-token");
    expect(response.status).toBe(200);
    expect(mocks.expireCheckoutSession).toHaveBeenCalledWith(expect.anything(), "cs_test_1");
    expect(mocks.markOrderPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_1",
      "cancelled",
    );
  });

  it("prevents another user from cancelling the order", async () => {
    const response = await request("attacker-token");
    expect(response.status).toBe(401);
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markOrderPaymentStatus).not.toHaveBeenCalled();
  });

  it("never cancels an already paid order", async () => {
    mocks.getOrderByPublicId.mockResolvedValue(
      orderFixture({
        result_token_hash: await hashToken("owner-token", "token-secret"),
        payment_status: "paid",
      }),
    );
    const response = await request("owner-token");
    expect(response.status).toBe(409);
    expect(mocks.expireCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markOrderPaymentStatus).not.toHaveBeenCalled();
  });

  it("does not mark cancelled if Stripe already reports completion", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue({
      id: "cs_test_1",
      status: "complete",
      payment_status: "paid",
    });
    const response = await request("owner-token");
    expect(response.status).toBe(409);
    expect(mocks.markOrderPaymentStatus).not.toHaveBeenCalled();
  });
});
