import { afterEach, describe, it, expect, vi } from "vitest";
import { isRateLimited, RATE_LIMITS } from "../src/lib/rateLimit";
import type { Env } from "../src/lib/types";
import { sqliteEnv } from "./helpers/sqlite";

afterEach(() => vi.restoreAllMocks());
describe("atomic request limits", () => {
  it("accepts only five of ten concurrent checkout requests", async () => {
    const { env, sqlite } = sqliteEnv();
    const results = await Promise.all(Array.from({ length: 10 }, () => isRateLimited(env, "create-checkout-ip", "1.2.3.4")));
    expect(results.filter((limited) => !limited)).toHaveLength(5);
    expect(sqlite.prepare("SELECT count FROM rate_limits").get()?.count).toBe(5);
    sqlite.close();
  });
  it("isolates scope, identity and time window; persists only hashed identities", async () => {
    const { env, sqlite } = sqliteEnv();
    const now = new Date("2026-09-11T12:00:00Z");
    for (let i = 0; i < RATE_LIMITS["contact-email"].limit; i++) {
      expect(await isRateLimited(env, "contact-email", "personal@example.com", now)).toBe(false);
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await isRateLimited(env, "contact-email", "personal@example.com", now)).toBe(true);
    expect(await isRateLimited(env, "contact-email", "different@example.com", now)).toBe(false);
    expect(await isRateLimited(env, "create-checkout-email", "personal@example.com", now)).toBe(false);
    expect(await isRateLimited(env, "contact-email", "personal@example.com", new Date(now.getTime() + 600001))).toBe(false);
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM rate_limits").all())).not.toContain("@example.com");
    expect(JSON.stringify(log.mock.calls)).not.toContain("personal@example.com");
    sqlite.close();
  });
  it("has room for a complete polling session and shared IPs", async () => {
    const { env, sqlite } = sqliteEnv();
    for (let i = 0; i < 75; i++) expect(await isRateLimited(env, "result-order", "order" )).toBe(false);
    expect(RATE_LIMITS["result-ip"].limit).toBeGreaterThan(RATE_LIMITS["result-order"].limit);
    sqlite.close();
  });
  it("fails closed without leaking identifiers or throwing on a database failure", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await isRateLimited({} as Env, "contact-ip", "private-ip")).toBe(true);
    const env = { TOKEN_HASH_SECRET: "test", DB: { prepare() { throw new Error("outage"); } } } as unknown as Env;
    expect(await isRateLimited(env, "contact-ip", "private-ip")).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-ip");
  });
});
