import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "../src/lib/turnstile";
import type { Env } from "../src/lib/types";

const env = {
  TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_EXPECTED_HOSTNAMES: "example.com,staging.example.com",
} as Env;

afterEach(() => vi.restoreAllMocks());

describe("Turnstile server verification", () => {
  it("requires the expected hostname and action and uses a timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, hostname: "example.com", action: "checkout" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      verifyTurnstileToken(env, "token", "192.0.2.1", "checkout"),
    ).resolves.toBe(true);

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(String(init?.body)).toContain("remoteip=192.0.2.1");
  });

  it("rejects a token issued for another hostname or action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, hostname: "evil.example", action: "checkout" }),
        { status: 200 },
      ),
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, hostname: "example.com", action: "contact" }),
        { status: 200 },
      ),
    );

    await expect(verifyTurnstileToken(env, "token", undefined, "checkout")).resolves.toBe(false);
    await expect(verifyTurnstileToken(env, "token", undefined, "checkout")).resolves.toBe(false);
  });

  it("fails closed on network errors and missing hostname configuration", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, hostname: "example.com", action: "checkout" }),
        { status: 200 },
      ),
    );

    await expect(verifyTurnstileToken(env, "token", undefined, "checkout")).resolves.toBe(false);
    await expect(
      verifyTurnstileToken(
        { ...env, TURNSTILE_EXPECTED_HOSTNAMES: "" },
        "token",
        undefined,
        "checkout",
      ),
    ).resolves.toBe(false);
  });
});
