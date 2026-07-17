import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRefundEmail } from "../src/lib/email";
import type { Env } from "../src/lib/types";

const env = {
  RESEND_API_KEY: "test-resend-key",
  EMAIL_FROM: "Service <noreply@example.com>",
  SITE_URL: "https://app.example.com",
  SELLER_NAME: "Example Seller",
  SELLER_ADDRESS: "Example Address",
} as Env;

const order = {
  id: "order-1",
  email: "customer@example.com",
  name: "Customer",
  server_calculated_price: 1_990,
  currency: "HUF",
};

describe("transactional email transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets a bounded request timeout and a User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendRefundEmail(env, order, null, "test")).resolves.toEqual({
      providerMessageId: "email-1",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(request.headers).get("User-Agent")).toBe("ugyfelkozpont-worker/0.1");
  });

  it("does not expose a provider response body in the thrown error", async () => {
    const sensitiveProviderBody = "recipient=customer@example.com; internal request details";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(sensitiveProviderBody, { status: 400 })),
    );

    await expect(sendRefundEmail(env, order, null, "test")).rejects.toThrow(
      "Resend API error (400)",
    );

    try {
      await sendRefundEmail(env, order, null, "test");
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveProviderBody);
      expect(String(error)).not.toContain("customer@example.com");
    }
  });
});
