import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import {
  checkoutExpiredEmailHtml,
  escapeHtml,
  invoiceEmailHtml,
  letterReadyEmailHtml,
  paymentFailedEmailHtml,
  refundEmailHtml,
  safeHtmlUrl,
} from "../src/lib/emailTemplates";
import { validateEnv } from "../src/lib/envValidation";
import { redactSensitive } from "../src/lib/logger";
import type { Env } from "../src/lib/types";

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {
      prepare: vi.fn(() => ({ run: vi.fn(async () => ({ success: true })) })),
    } as unknown as D1Database,
    RATE_LIMIT_KV: {} as KVNamespace,
    GEMINI_API_KEY: "gemini-key",
    TOKEN_HASH_SECRET: "token-secret",
    SITE_URL: "https://example.com",
    ALLOWED_ORIGINS: "https://example.com",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    PAYMENTS_ENABLED: "false",
    DEMO_MODE: "false",
    ...overrides,
  } as Env;
}

function invoiceData() {
  return {
    invoiceNumber: "INV-<1>",
    issuedAt: "2026-01-01T00:00:00.000Z",
    customerName: "Elek <img src=x onerror=1>",
    customerEmail: `customer"'<evil@example.com>`,
    serviceName: "Levélírás <script>",
    amount: 890,
    currency: "HUF",
    sellerName: "Seller <b>",
    sellerAddress: "Address & Co.",
    sellerTaxNumber: "123'456",
  };
}

describe("email HTML escaping and URL safety", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes names, email values, invoice fields, and seller fields", () => {
    const html = invoiceEmailHtml(invoiceData());

    expect(html).toContain("Elek &lt;img src=x onerror=1&gt;");
    expect(html).toContain("customer&quot;&#39;&lt;evil@example.com&gt;");
    expect(html).toContain("Levélírás &lt;script&gt;");
    expect(html).toContain("Seller &lt;b&gt;");
    expect(html).toContain("Address &amp; Co.");
    expect(html).not.toContain("Elek <img");
    expect(html).not.toContain("Levélírás <script>");
  });

  it("escapes reasons and generated letters", () => {
    const refund = refundEmailHtml({
      customerName: "Name",
      invoiceNumber: "INV-1",
      amount: 890,
      currency: "HUF",
      reason: `<script>alert("x")</script>`,
      siteUrl: "https://example.com/base",
      sellerName: "Seller",
      sellerAddress: "Address",
    });
    const letter = letterReadyEmailHtml({
      customerName: "Name <b>",
      letter: `<h1>"Hello" & 'bye'</h1>`,
      orderUrl: "https://example.com/order?token=abc&ok=true",
      sellerName: "Seller",
      sellerAddress: "Address",
    });

    expect(refund).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(letter).toContain("&lt;h1&gt;&quot;Hello&quot; &amp; &#39;bye&#39;&lt;/h1&gt;");
    expect(letter).toContain("Name &lt;b&gt;");
    expect(letter).toContain('href="https://example.com/order?token=abc&amp;ok=true"');
  });

  it("keeps safe HTTPS and local development HTTP URLs", () => {
    expect(safeHtmlUrl("https://example.com/base", "level-keszites")).toBe(
      "https://example.com/base/level-keszites",
    );
    expect(safeHtmlUrl("http://127.0.0.1:5173", "level-keszites")).toBe(
      "http://127.0.0.1:5173/level-keszites",
    );
  });

  it("rejects javascript, data, and unsupported URL schemes", () => {
    expect(() => safeHtmlUrl("javascript:alert(1)")).toThrow(/Unsupported/);
    expect(() => safeHtmlUrl("data:text/html,hi")).toThrow(/Unsupported/);
    expect(() => safeHtmlUrl("ftp://example.com/file")).toThrow(/Unsupported/);
    expect(() =>
      paymentFailedEmailHtml({
        customerName: "Name",
        amount: 890,
        currency: "HUF",
        siteUrl: "javascript:alert(1)",
        sellerName: "Seller",
        sellerAddress: "Address",
      }),
    ).toThrow(/Unsupported/);
  });

  it("escapes safe URL attribute values on generated links", () => {
    const html = checkoutExpiredEmailHtml({
      customerName: "Name",
      siteUrl: "https://example.com/base",
      sellerName: "Seller",
      sellerAddress: "Address",
    });

    expect(html).toContain('href="https://example.com/base/level-keszites"');
  });
});

describe("recursive logger redaction", () => {
  it("redacts nested objects, arrays, mixed structures, and case variants", () => {
    const output = redactSensitive({
      normal: "kept",
      nested: {
        apiKey: "secret-value",
        Cookie: "session=value",
        child: [{ Authorization: "Bearer abc123" }, { regular: "visible" }],
      },
    }) as Record<string, unknown>;

    expect(output.normal).toBe("kept");
    expect(output).toMatchObject({
      nested: {
        apiKey: "[redacted]",
        Cookie: "[redacted]",
        child: [{ Authorization: "[redacted]" }, { regular: "visible" }],
      },
    });
  });

  it("handles cycles, excessive depth, and Error objects without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const tooDeep = { a: { b: { c: { d: { e: { f: "hidden" } } } } } };
    const output = redactSensitive({
      cyclic,
      tooDeep,
      error: new Error("provider failed with sk_test_secretvalue"),
    }) as Record<string, unknown>;

    expect(JSON.stringify(output)).toContain("[cycle]");
    expect(JSON.stringify(output)).toContain("[max-depth]");
    expect(JSON.stringify(output)).not.toContain("sk_test_secretvalue");
    expect(output).toHaveProperty(["error", "name"], "Error");
  });

  it("preserves ordinary non-sensitive fields", () => {
    expect(redactSensitive({ count: 1, ok: true, label: "visible" })).toMatchObject({
      count: 1,
      ok: true,
      label: "visible",
    });
  });
});

describe("environment validation", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("passes normal mode with all required values", () => {
    expect(validateEnv(baseEnv()).ok).toBe(true);
  });

  it("requires Stripe configuration only when payment mode is enabled", () => {
    expect(validateEnv(baseEnv({ PAYMENTS_ENABLED: "false" })).ok).toBe(true);
    expect(validateEnv(baseEnv({ PAYMENTS_ENABLED: "true" })).missing).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(
      validateEnv(
        baseEnv({
          PAYMENTS_ENABLED: "true",
          STRIPE_SECRET_KEY: "stripe-secret",
          STRIPE_WEBHOOK_SECRET: "webhook-secret",
        }),
      ).ok,
    ).toBe(true);
  });

  it("requires a demo access code only in demo-only mode", () => {
    expect(validateEnv(baseEnv({ DEMO_MODE: "true", PAYMENTS_ENABLED: "false" })).missing).toContain(
      "DEMO_ACCESS_CODE",
    );
    expect(
      validateEnv(
        baseEnv({
          DEMO_MODE: "true",
          PAYMENTS_ENABLED: "false",
          DEMO_ACCESS_CODE: "demo-code",
        }),
      ).ok,
    ).toBe(true);
    expect(validateEnv(baseEnv({ DEMO_MODE: "false", DEMO_ACCESS_CODE: "" })).ok).toBe(true);
  });

  it("keeps health available and generic when env is incomplete", async () => {
    const response = await app.fetch(
      new Request("https://worker.test/api/health", {
        headers: { Origin: "https://example.com" },
      }),
      baseEnv({ RATE_LIMIT_KV: undefined, GEMINI_API_KEY: "" }),
      {} as ExecutionContext,
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("degraded");
    expect(text).not.toContain("GEMINI_API_KEY");
    expect(text).not.toContain("RATE_LIMIT_KV");
    expect(text).not.toContain("missing");
  });

  it("blocks normal API routes when env is incomplete", async () => {
    const response = await app.fetch(
      new Request("https://worker.test/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://example.com" },
        body: JSON.stringify({}),
      }),
      baseEnv({ GEMINI_API_KEY: "" }),
      {} as ExecutionContext,
    );
    const payload = await response.json() as { error?: { code?: string; message?: string } };

    expect(response.status).toBe(503);
    expect(payload.error?.code).toBe("SERVICE_UNAVAILABLE");
    expect(JSON.stringify(payload)).not.toContain("GEMINI_API_KEY");
  });

  it("does not run scheduled work when env is incomplete", async () => {
    const prepare = vi.fn();
    await app.scheduled(
      {} as ScheduledController,
      baseEnv({
        DB: { prepare } as unknown as D1Database,
        GEMINI_API_KEY: "",
      }),
    );

    expect(prepare).not.toHaveBeenCalled();
  });
});
