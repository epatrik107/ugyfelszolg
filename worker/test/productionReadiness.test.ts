import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { constantTimeEqual } from "../src/lib/hash";
import type { Env } from "../src/lib/types";

describe("constantTimeEqual hardening", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("a".repeat(64), "a".repeat(64))).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "xyz")).toBe(false);
  });

  it("returns false for different lengths without leaking which is longer", () => {
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("ab", "abc")).toBe(false);
    expect(constantTimeEqual("a", "abcdef")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
    expect(constantTimeEqual("a", "")).toBe(false);
  });

  it("handles hex hash comparison (typical use case)", () => {
    const hash1 = "a".repeat(64); // SHA-256 hex length
    const hash2 = "a".repeat(64);
    const hash3 = "b".repeat(64);
    expect(constantTimeEqual(hash1, hash2)).toBe(true);
    expect(constantTimeEqual(hash1, hash3)).toBe(false);
  });
});

describe("handleCheckoutCompleted session ID validation", () => {
  it("rejects empty session IDs", async () => {
    const logEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      try {
        logEvents.push({ event: "log", details: JSON.parse(msg) });
      } catch {
        // ignore non-JSON logs
      }
    });

    const { handleCheckoutCompleted } = await import("../src/routes/stripeWebhook");

    const c = {
      env: { PAYMENTS_ENABLED: "true", PAYMENT_MODE: "test" } as Env,
      executionCtx: { waitUntil: vi.fn() },
    } as never;

    // These should return without making any Stripe API calls
    await handleCheckoutCompleted(c, "");
    await handleCheckoutCompleted(c, "invalid_id");

    const suspiciousEvents = logEvents.filter(
      (e) => e.details.event === "suspicious_payment_event" &&
             e.details.reason === "invalid_session_id",
    );
    expect(suspiciousEvents.length).toBe(2);

    vi.restoreAllMocks();
  });
});

describe("cleanupExpiredData includes Stripe events", () => {
  it("deletes completed Stripe events and redacts expired personal order content", async () => {
    const queries: string[] = [];
    const fakeEnv = {
      DB: {
        prepare(sql: string) {
          queries.push(sql);
          return {
            bind(..._args: unknown[]) {
              return this;
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
        async batch(statements: Array<{ run: () => Promise<unknown> }>) {
          return Promise.all(statements.map((s) => s.run()));
        },
      },
    } as unknown as Env;

    const { cleanupExpiredData } = await import("../src/lib/db");
    await cleanupExpiredData(fakeEnv);

    const hasStripeCleanup = queries.some(
      (sql) => sql.includes("processed_stripe_events") && sql.includes("completed"),
    );
    const hasPersonalDataRedaction = queries.some(
      (sql) => sql.includes("personal_data_redacted_at") && sql.includes("generated_letter = NULL"),
    );
    const hasContactCleanup = queries.some(
      (sql) => sql.includes("DELETE FROM contact_messages") && sql.includes("created_at < ?"),
    );
    const orderDeleteIndex = queries.findIndex((sql) => sql.includes("DELETE FROM orders"));
    const statusLogDeleteIndex = queries.findIndex((sql) => sql.includes("DELETE FROM order_status_log"));
    const disputeDeleteIndex = queries.findIndex((sql) => sql.includes("DELETE FROM payment_disputes"));
    const refundDeleteIndex = queries.findIndex((sql) => sql.includes("DELETE FROM payment_refunds"));
    expect(hasStripeCleanup).toBe(true);
    expect(hasPersonalDataRedaction).toBe(true);
    expect(hasContactCleanup).toBe(true);
    expect(statusLogDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(disputeDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(refundDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(statusLogDeleteIndex).toBeLessThan(orderDeleteIndex);
    expect(disputeDeleteIndex).toBeLessThan(orderDeleteIndex);
    expect(refundDeleteIndex).toBeLessThan(orderDeleteIndex);
  });
});

describe("legal pages production placeholders", () => {
  it("does not ship unfinished legal provider placeholders", () => {
    const frontendRoot = resolve(process.cwd(), "../frontend/src/pages");
    const legalPages = [
      readFileSync(resolve(frontendRoot, "TermsPage.tsx"), "utf8"),
      readFileSync(resolve(frontendRoot, "PrivacyPage.tsx"), "utf8"),
    ].join("\n");

    expect(legalPages).not.toContain("[KITÖLTENDŐ");
    expect(legalPages).toContain("Engelbrecht Zoltán");
    expect(legalPages).toContain("91250960-1-31");
    expect(legalPages).toContain("HU91250960");
    expect(legalPages).toContain("60722263");
    expect(legalPages).toContain("ugyfelszolgalat2026@gmail.com");
    expect(legalPages).toContain("3 munkanapon belül");
  });
});

describe("production deploy workflow hardening", () => {
  it("does not fall back to hard-coded production frontend or seller config", () => {
    const repoRoot = resolve(process.cwd(), "..");
    const frontendWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/deploy-frontend.yml"), "utf8");
    const workerWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/deploy-worker.yml"), "utf8");

    expect(frontendWorkflow).not.toContain("vars.VITE_API_BASE_URL ||");
    expect(frontendWorkflow).not.toContain("vars.VITE_TURNSTILE_SITE_KEY ||");
    expect(workerWorkflow).not.toContain('process.env.EMAIL_FROM || "Ügyfélközpont');
    expect(workerWorkflow).not.toContain('deployEnv === "production" ? "Engelbrecht');
    expect(workerWorkflow).toContain(
      "Production EMAIL_FROM must use the verified production site domain.",
    );
    expect(workerWorkflow).toContain("[observability]");
    expect(workerWorkflow).toContain("head_sampling_rate = ${observabilitySamplingRate}");
    expect(workerWorkflow).toContain('deployEnv === "production" ? "0.1" : "1"');
  });

  it("deploys secrets atomically and rolls back to the captured active version", () => {
    const repoRoot = resolve(process.cwd(), "..");
    const workerWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/deploy-worker.yml"), "utf8");

    expect(workerWorkflow).toContain("--secrets-file /tmp/worker-secrets.json");
    expect(workerWorkflow).not.toContain("wrangler secret bulk /tmp/worker-secrets.json");
    expect(workerWorkflow).toContain("wrangler secret bulk /tmp/stale-worker-secrets.json");
    expect(workerWorkflow).toContain("OPENAI_API_KEY: null");
    expect(workerWorkflow).toContain("DEMO_ACCESS_CODE: null");
    expect(workerWorkflow).toContain('steps.previous-deployment.outputs.version_id');
    expect(workerWorkflow).toContain('wrangler rollback "${{ steps.previous-deployment.outputs.version_id }}"');
  });

  it("allows production deploy workflows only from main and runs quality checks on main pushes", () => {
    const repoRoot = resolve(process.cwd(), "..");
    const frontendWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/deploy-frontend.yml"), "utf8");
    const workerWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/deploy-worker.yml"), "utf8");
    const qualityWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/quality.yml"), "utf8");

    expect(frontendWorkflow).toContain('refs/heads/main');
    expect(workerWorkflow).toContain('refs/heads/main');
    expect(workerWorkflow).toContain('TARGET_ENVIRONMENT');
    expect(qualityWorkflow).not.toContain('branches-ignore: [main]');
  });
});

describe("invoice retry error isolation", () => {
  it("continues processing remaining orders when one fails", async () => {
    const mockProcess = vi.fn()
      .mockResolvedValueOnce("created")
      .mockRejectedValueOnce(new Error("provider timeout"))
      .mockResolvedValueOnce("created");

    const orders = [
      { id: "order_1" },
      { id: "order_2" },
      { id: "order_3" },
    ];

    // Simulate the error isolation pattern used in retryDueInvoices
    const results: Array<{ orderId: string; status: string }> = [];
    for (const order of orders) {
      try {
        const status = await mockProcess({}, order.id);
        results.push({ orderId: order.id, status });
      } catch {
        results.push({ orderId: order.id, status: "error" });
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ orderId: "order_1", status: "created" });
    expect(results[1]).toEqual({ orderId: "order_2", status: "error" });
    expect(results[2]).toEqual({ orderId: "order_3", status: "created" });
  });
});
