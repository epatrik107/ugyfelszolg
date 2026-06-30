import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/lib/types";

function env(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGINS: "https://example.com",
    GEMINI_API_KEY: "gemini-key",
    TOKEN_HASH_SECRET: "token-secret",
    SITE_URL: "https://example.com",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    DEMO_MODE: "false",
    PAYMENTS_ENABLED: "false",
    DB: {
      prepare() {
        return { run: async () => ({ meta: { changes: 1 } }) };
      },
    } as unknown as D1Database,
    ...overrides,
  } as Env;
}

describe("API middleware", () => {
  it("handles allowed CORS preflight and rejects forbidden origins", async () => {
    const allowed = await app.fetch(
      new Request("https://worker.test/api/contact", {
        method: "OPTIONS",
        headers: { Origin: "https://example.com" },
      }),
      env(),
      {} as ExecutionContext,
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");

    const forbidden = await app.fetch(
      new Request("https://worker.test/api/contact", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env(),
      {} as ExecutionContext,
    );
    expect(forbidden.status).toBe(403);
  });

  it("enforces JSON content type and body size before routes run", async () => {
    const contentType = await app.fetch(
      new Request("https://worker.test/api/contact", {
        method: "POST",
        headers: { Origin: "https://example.com", "Content-Type": "text/plain" },
        body: "hello",
      }),
      env(),
      {} as ExecutionContext,
    );
    expect(contentType.status).toBe(400);

    const tooLarge = await app.fetch(
      new Request("https://worker.test/api/contact", {
        method: "POST",
        headers: {
          Origin: "https://example.com",
          "Content-Type": "application/json",
          "Content-Length": String(65 * 1024),
        },
        body: "{}",
      }),
      env(),
      {} as ExecutionContext,
    );
    expect(tooLarge.status).toBe(413);
  });

  it("adds security headers and returns the JSON 404 handler", async () => {
    const response = await app.fetch(
      new Request("https://worker.test/no-such-route"),
      env(),
      {} as ExecutionContext,
    );
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("NOT_FOUND");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });
});
