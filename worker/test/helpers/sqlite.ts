import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Env, OrderRow } from "../../src/lib/types";
import { orderFixture } from "../fixtures";

/** Execute production SQL against SQLite with the same foreign-key constraint
 * behavior as D1. Only the D1 transport is adapted; queries are not mocked. */
export function sqliteEnv() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const directory = fileURLToPath(new URL("../../migrations/", import.meta.url));
  for (const file of readdirSync(directory).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${directory}/${file}`, "utf8"));
  }
  function statement(sql: string, args: SQLInputValue[] = []) {
    return {
      bind(...values: SQLInputValue[]) { return statement(sql, values); },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
    };
  }
  const env = {
    DB: {
      prepare: statement,
      async batch(statements: ReturnType<typeof statement>[]) {
        sqlite.exec("BEGIN");
        try {
          const results = [];
          for (const stmt of statements) results.push(await stmt.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    } as unknown as D1Database,
    GEMINI_API_KEY: "synthetic-test-key",
    TOKEN_HASH_SECRET: "synthetic-test-token-secret-at-least-32-chars",
    SITE_URL: "https://example.com", ALLOWED_ORIGINS: "https://example.com",
    TURNSTILE_SECRET_KEY: "synthetic-turnstile", TURNSTILE_EXPECTED_HOSTNAMES: "example.com",
    LEGAL_TERMS_VERSION: "1.5", PRIVACY_POLICY_VERSION: "1.3",
    DEMO_MODE: "false", PAYMENTS_ENABLED: "false", PAYMENT_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    RATE_LIMIT_KV: {} as KVNamespace,
  } as Env;
  function addOrder(id: string, overrides: Partial<OrderRow> = {}) {
    const row = orderFixture({ id, public_id: id, checkout_idempotency_key: id,
      stripe_session_id: `cs_${id}`, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), ...overrides });
    const keys = Object.keys(row) as (keyof OrderRow)[];
    sqlite.prepare(`INSERT INTO orders (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...keys.map((key) => row[key] ?? null));
  }
  return { env, sqlite, addOrder };
}
