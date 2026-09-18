import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredData, getOrderById } from "../src/lib/db";
import { processGenerationJobs, processRefundJobs } from "../src/lib/jobs";
import { collectOperatorIssues } from "../src/lib/ops";
import { recordReviewAttempt } from "../src/lib/reviewDiagnostics";
import { ensurePoliteClosing, reviewLetterWithRules } from "../src/lib/review";
import { sqliteEnv } from "./helpers/sqlite";
import { rentalSource, validRentalLetter } from "./fixtures/rental";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const rejected = { ok: false, issues: [{ code: "unsupported_fact", field: "request", instruction: "Ne találj ki fizetési határidőt; private@example.com" }] };
const response = (value: unknown) => Response.json({ candidates: [{ content: { parts: [{ text: typeof value === "string" ? value : JSON.stringify(value) }] } }] });

describe("review diagnostics and paid fulfillment", () => {
  it("preserves the incident's goals without requiring an invented amount or deadline", () => {
    expect(reviewLetterWithRules(validRentalLetter)).toMatchObject({ ok: true, blockers: [] });
  });

  it("adds only the missing polite closing before a correct existing signer", () => {
    const missing = validRentalLetter.replace("Üdvözlettel:\n", "");
    expect(ensurePoliteClosing(missing, rentalSource.name)).toBe(validRentalLetter.replace("Üdvözlettel:", "Tisztelettel:"));
    expect(ensurePoliteClosing(validRentalLetter, rentalSource.name)).toBe(validRentalLetter);
    expect(ensurePoliteClosing(missing.replace("Minta Anna", "Hibás Aláíró"), rentalSource.name)).toContain("Hibás Aláíró");
    expect(ensurePoliteClosing(missing.replace("Minta Anna", "Hibás Aláíró"), rentalSource.name)).not.toContain("Tisztelettel:");
  });

  it("reviews the normalized text before publishing rather than spending a repair on the closing", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    try {
      addOrder("closing", { ...rentalSource, payment_status: "paid", ai_status: "not_started", generation_count: 0 });
      const raw = validRentalLetter.replace("Üdvözlettel:\n", "");
      const replies = [response(raw), response({ ok: true, issues: [] })];
      const fetch = vi.fn(async (_url: string, _init: RequestInit) => replies.shift());
      vi.stubGlobal("fetch", fetch);
      await processGenerationJobs(env);
      const expected = ensurePoliteClosing(raw, rentalSource.name);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetch.mock.calls[1][1].body)).contents[0].parts[0].text).toContain(expected);
      expect(await getOrderById(env, "closing")).toMatchObject({ generated_letter: expected, ai_status: "completed", refund_requested_at: null });
    } finally { sqlite.close(); }
  });

  it("repairs within two candidates and persists only classifications, with no refund or invoice", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    try {
      addOrder("repair", { ...rentalSource, payment_status: "paid", ai_status: "not_started", generation_count: 0, invoice_status: "not_required" });
      const calls: RequestInit[] = [];
      const replies = [response(validRentalLetter), response(rejected), response(validRentalLetter), response({ ok: true, issues: [] })];
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return replies.shift(); }));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(await processGenerationJobs(env)).toBe(1);
      expect(await processGenerationJobs(env)).toBe(0);
      const saved = await getOrderById(env, "repair");
      expect(saved).toMatchObject({ ai_status: "completed", generated_letter: validRentalLetter, refund_requested_at: null, generation_count: 1 });
      const reviews = sqlite.prepare("SELECT * FROM generation_reviews ORDER BY attempt").all();
      expect(reviews).toHaveLength(2);
      expect(reviews[0]).toMatchObject({ outcome: "rejected", findings_json: '[{"code":"unsupported_fact","field":"request"}]' });
      expect(reviews[1]).toMatchObject({ outcome: "approved", findings_json: "[]" });
      expect(JSON.stringify(reviews)).not.toContain("private@example.com");
      expect(JSON.stringify(reviews)).not.toContain(validRentalLetter);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private@example.com");
      expect(String(calls[2].body)).toContain("unsupported_fact/request");
      expect(await processRefundJobs(env)).toBe(0);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    } finally { sqlite.close(); }
  });

  it("records both rejections, refunds once, and still reports the refunded failure", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    try {
      addOrder("blocked", { ...rentalSource, payment_status: "paid", ai_status: "not_started", generation_count: 0, stripe_payment_intent_id: "pi_synthetic_blocked", paid_amount: 890, invoice_status: "not_required" });
      const replies = [response(validRentalLetter), response(rejected), response(validRentalLetter), response(rejected)];
      const fetch = vi.fn(async (url: string) => url.includes("api.stripe.com")
        ? Response.json({ id: "re_synthetic", status: "succeeded", amount: 89000, currency: "huf", payment_intent: "pi_synthetic_blocked" })
        : replies.shift());
      vi.stubGlobal("fetch", fetch);
      await processGenerationJobs(env);
      expect(await getOrderById(env, "blocked")).toMatchObject({ ai_status: "failed_review", generated_letter: null, refund_requested_at: expect.any(String) });
      expect(await processRefundJobs(env)).toBe(1);
      expect(await processRefundJobs(env)).toBe(0);
      expect(await getOrderById(env, "blocked")).toMatchObject({ payment_status: "refunded", invoice_status: "not_required" });
      expect(fetch.mock.calls.filter(([url]) => url.includes("api.stripe.com"))).toHaveLength(1);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM generation_reviews WHERE outcome = 'rejected'").get()).toEqual({ n: 2 });
      const issues = await collectOperatorIssues(env);
      expect(JSON.stringify(issues)).toContain("generation_failed");
      expect(JSON.stringify(issues)).toContain("blocked");
    } finally { sqlite.close(); }
  });

  it("does not persist stale, refunded, redacted or expired review results; deduplicates the same attempt", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    const observation = { attempt: 0, outcome: "approved" as const, findings: [], ruleBlockerCount: 0 };
    try {
      addOrder("claim", { payment_status: "paid", ai_status: "generating", generation_run_id: "current" });
      const order = (await getOrderById(env, "claim"))!;
      expect(await recordReviewAttempt(env, { ...order, generation_run_id: "stale" }, "stale", observation)).toBe(false);
      expect(await recordReviewAttempt(env, order, "current", observation)).toBe(true);
      expect(await recordReviewAttempt(env, order, "current", observation)).toBe(false);
      for (const update of ["payment_status = 'refunded'", "payment_status = 'paid', personal_data_redacted_at = '2026-01-01'", "personal_data_redacted_at = NULL, created_at = '2020-01-01'"]) {
        sqlite.exec(`UPDATE orders SET ${update} WHERE id = 'claim'`);
        expect(await recordReviewAttempt(env, order, "current", { ...observation, attempt: 1 })).toBe(false);
      }
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM generation_reviews").get()).toEqual({ n: 1 });
    } finally { sqlite.close(); }
  });

  it("removes diagnostics with order retention and cascades an order deletion", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    try {
      for (const id of ["expired", "fresh"]) {
        addOrder(id, { payment_status: "paid", ai_status: "generating", generation_run_id: id });
        await recordReviewAttempt(env, (await getOrderById(env, id))!, id, { attempt: 0, outcome: "approved", findings: [], ruleBlockerCount: 0 });
      }
      sqlite.exec("UPDATE orders SET created_at = '2020-01-01' WHERE id = 'expired'");
      await cleanupExpiredData(env);
      expect(sqlite.prepare("SELECT order_id FROM generation_reviews").all()).toEqual([{ order_id: "fresh" }]);
      sqlite.exec("DELETE FROM orders WHERE id = 'fresh'");
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM generation_reviews").get()).toEqual({ n: 0 });
    } finally { sqlite.close(); }
  });

  it("keeps a generation recoverable if diagnostic storage fails, without initiating a refund", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    try {
      addOrder("storage", { ...rentalSource, payment_status: "paid", ai_status: "not_started", generation_count: 0 });
      sqlite.exec("CREATE TRIGGER reject_review BEFORE INSERT ON generation_reviews BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
      const replies = [response(validRentalLetter), response({ ok: true, issues: [] })];
      vi.stubGlobal("fetch", vi.fn(async () => replies.shift()));
      await processGenerationJobs(env);
      expect(await getOrderById(env, "storage")).toMatchObject({ ai_status: "generating", refund_requested_at: null, generation_claimed_at: expect.any(String) });
    } finally { sqlite.close(); }
  });
});
