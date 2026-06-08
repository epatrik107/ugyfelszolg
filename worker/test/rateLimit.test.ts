import { describe, it, expect, vi } from "vitest";
import { isRateLimited, RATE_LIMITS, type RateLimitScope } from "../src/lib/rateLimit";
import type { Env } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Minimal in-memory KV mock
// ---------------------------------------------------------------------------
function makeKvMock() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, _opts?: unknown) {
      store.set(key, value);
    },
  };
}

function makeEnv(kv: unknown = makeKvMock()): Env {
  return { RATE_LIMIT_KV: kv } as unknown as Env;
}

function makeEnvWithoutKv(): Env {
  return {} as Env;
}

describe("isRateLimited", () => {
  const scope: RateLimitScope = "contact-ip";
  const identifier = "1.2.3.4";
  const now = new Date("2025-01-15T12:00:00Z");

  it("allows the first request under the limit", async () => {
    const env = makeEnv();
    expect(await isRateLimited(env, scope, identifier, now)).toBe(false);
  });

  it("allows requests up to the limit then blocks the next one", async () => {
    const env = makeEnv();
    const { limit } = RATE_LIMITS[scope];

    for (let i = 0; i < limit; i++) {
      expect(await isRateLimited(env, scope, identifier, now)).toBe(false);
    }
    // The (limit + 1)th request must be blocked
    expect(await isRateLimited(env, scope, identifier, now)).toBe(true);
  });

  it("different identifiers have independent counters", async () => {
    const env = makeEnv();
    const { limit } = RATE_LIMITS[scope];

    // Exhaust limit for identifier A
    for (let i = 0; i < limit; i++) {
      await isRateLimited(env, scope, identifier, now);
    }
    expect(await isRateLimited(env, scope, identifier, now)).toBe(true);

    // Identifier B should still be allowed
    expect(await isRateLimited(env, scope, "5.6.7.8", now)).toBe(false);
  });

  it("different scopes have independent counters", async () => {
    const env = makeEnv();
    const contactLimit = RATE_LIMITS["contact-ip"].limit;

    for (let i = 0; i < contactLimit; i++) {
      await isRateLimited(env, "contact-ip", identifier, now);
    }
    expect(await isRateLimited(env, "contact-ip", identifier, now)).toBe(true);
    // A different scope for the same IP is unaffected
    expect(await isRateLimited(env, "result-ip", identifier, now)).toBe(false);
  });

  it("when KV binding is missing it blocks the request (fail-closed) and logs", async () => {
    const env = makeEnvWithoutKv();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await isRateLimited(env, scope, identifier, now)).toBe(true);
    // The logger uses console.log – check that the missing-KV event was recorded
    // (the logger.ts implementation may use console.log, console.warn or similar)
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("a new time window resets the counter", async () => {
    const env = makeEnv();
    const { limit, windowSeconds } = RATE_LIMITS[scope];

    for (let i = 0; i <= limit; i++) {
      await isRateLimited(env, scope, identifier, now);
    }
    expect(await isRateLimited(env, scope, identifier, now)).toBe(true);

    // Advance to the next window bucket
    const nextWindow = new Date(now.getTime() + windowSeconds * 1000 + 1);
    expect(await isRateLimited(env, scope, identifier, nextWindow)).toBe(false);
  });
});
