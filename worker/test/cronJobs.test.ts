import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/types";
const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), generation: vi.fn(), refund: vi.fn(), invoice: vi.fn() }));
vi.mock("../src/lib/db", () => ({ cleanupExpiredData: mocks.cleanup }));
vi.mock("../src/lib/jobs", () => ({ processGenerationJobs: mocks.generation, processRefundJobs: mocks.refund }));
vi.mock("../src/lib/invoice", () => ({ retryDueInvoices: mocks.invoice }));
const worker = (await import("../src/index")).default;
const env = {
  GEMINI_API_KEY: "test", TOKEN_HASH_SECRET: "synthetic-secret-with-at-least-32-chars",
  SITE_URL: "https://example.com", ALLOWED_ORIGINS: "https://example.com",
  TURNSTILE_SECRET_KEY: "test", TURNSTILE_EXPECTED_HOSTNAMES: "example.com",
  LEGAL_TERMS_VERSION: "1.5", PRIVACY_POLICY_VERSION: "1.3", DEMO_MODE: "false", PAYMENTS_ENABLED: "false",
  DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) }, RATE_LIMIT_KV: {},
} as unknown as Env;
const controller = (time: string) => ({ scheduledTime: Date.parse(time) }) as ScheduledController;
describe("minute scheduler", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.invoice.mockResolvedValue([]); });
  it("runs jobs every minute, but retention only at 02:17 UTC", async () => {
    await worker.scheduled(controller("2026-09-11T12:00:00Z"), env);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.generation).toHaveBeenCalledOnce(); expect(mocks.refund).toHaveBeenCalledOnce(); expect(mocks.invoice).toHaveBeenCalledOnce();
    await worker.scheduled(controller("2026-09-11T02:17:00Z"), env);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
  it("continues other work when retention or a provider job fails", async () => {
    mocks.cleanup.mockRejectedValueOnce(new Error("retention failure"));
    mocks.generation.mockRejectedValueOnce(new Error("generation failure"));
    await worker.scheduled(controller("2026-09-11T02:17:00Z"), env);
    expect(mocks.refund).toHaveBeenCalledOnce(); expect(mocks.invoice).toHaveBeenCalledOnce();
  });
});
