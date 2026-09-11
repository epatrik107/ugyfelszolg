import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginGeneration, beginRegeneration, cleanupExpiredData, completeGeneration, failGeneration, getInvoiceRetryCandidates, getOrderById } from "../src/lib/db";
import { processGenerationJobs, processRefundJobs } from "../src/lib/jobs";
import { canRequestRegeneration } from "../src/lib/orderState";
import { getOrderResultRoute } from "../src/routes/getOrderResult";
import { hashToken } from "../src/lib/hash";
import { sqliteEnv } from "./helpers/sqlite";
import type { Env } from "../src/lib/types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("durable generation and financial recovery", () => {
  it("preserves the previous letter during and after failed regeneration without spending its retry or refunding", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("regen", { payment_status: "paid", ai_status: "completed", generation_count: 1,
      generated_letter: "Korábbi jó levél", letter_email_sent: 1, stripe_payment_intent_id: "pi_regen",
      result_token_hash: await hashToken("owner-token", env.TOKEN_HASH_SECRET) });
    expect(await beginRegeneration(env, "regen", 3, "Rövidebben")).toBe(true);
    expect((await getOrderById(env, "regen"))?.generation_feedback).toBe("Rövidebben");
    const app = new Hono<{ Bindings: Env }>(); app.get("/orders/:publicId/result", getOrderResultRoute);
    async function result() {
      const response = await app.fetch(new Request("https://example.com/orders/regen/result", { headers: { Authorization: "Bearer owner-token" } }), env);
      return (await response.json() as { data: { generatedLetter?: string; regenerationError?: string } }).data;
    }
    expect((await result()).generatedLetter).toBe("Korábbi jó levél");
    expect(await failGeneration(env, "regen", "failed", "provider unavailable")).toBe(true);
    const failed = (await getOrderById(env, "regen"))!;
    expect(failed.ai_status).toBe("completed"); expect(failed.generation_count).toBe(1);
    expect(failed.letter_email_sent).toBe(1); expect(failed.refund_requested_at).toBeNull();
    expect(canRequestRegeneration(failed, 3)).toBe(true);
    expect((await result()).regenerationError).toBeTruthy();
    expect(await processRefundJobs(env)).toBe(0);
    sqlite.close();
  });

  it("recovers paid orders even if the HTTP handler stopped before queue activation; claims once", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("queued", { payment_status: "paid", ai_status: "not_started" });
    let release!: (response: Response) => void;
    let entered!: () => void;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    const fetchMock = vi.fn(() => { entered(); return new Promise<Response>((resolve) => { release = resolve; }); });
    vi.stubGlobal("fetch", fetchMock);
    const first = processGenerationJobs(env);
    await called;
    expect(await processGenerationJobs(env)).toBe(0);
    release(new Response("{}", { status: 503 }));
    expect(await first).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getOrderById(env, "queued"))?.ai_status).toBe("failed");
    sqlite.close();
  });

  it("rejects stale generation results after a replacement claim", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("leased", { payment_status: "paid", ai_status: "generating", generation_count: 1, generation_run_id: "new-run" });
    expect(await completeGeneration(env, "leased", "stale letter", null, "old-run")).toBe(false);
    expect(await failGeneration(env, "leased", "failed", "stale error", null, "old-run")).toBe(false);
    expect(await completeGeneration(env, "leased", "new letter", null, "new-run")).toBe(true);
    sqlite.close();
  });

  it("recovers interrupted regeneration after its lease and never refunds an already delivered letter", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("interrupted", { payment_status: "paid", ai_status: "generating", generation_count: 2,
      generated_letter: "Korábbi levél", stripe_payment_intent_id: "pi_existing", generation_attempts: 3,
      generation_claimed_at: new Date(Date.now() - 21 * 60000).toISOString() });
    expect(await processGenerationJobs(env)).toBe(1);
    const order = (await getOrderById(env, "interrupted"))!;
    expect(order.ai_status).toBe("completed"); expect(order.generation_count).toBe(1);
    expect(order.refund_requested_at).toBeNull();
    sqlite.close();
  });

  it("persists a refund intent before network I/O, retries with the same idempotency key and settles once", async () => {
    vi.useFakeTimers();
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("refund", { payment_status: "paid", ai_status: "generating", generation_count: 1, stripe_payment_intent_id: "pi_refund" });
    expect(await failGeneration(env, "refund", "failed", "synthetic failure")).toBe(true);
    expect((await getOrderById(env, "refund"))?.refund_requested_at).toBeTruthy();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(Response.json({ id: "re_refund", status: "succeeded", amount: 89000, currency: "huf", payment_intent: "pi_refund" }));
    vi.stubGlobal("fetch", fetchMock);
    await processRefundJobs(env);
    expect((await getOrderById(env, "refund"))?.payment_status).toBe("paid");
    expect(await processRefundJobs(env)).toBe(0);
    vi.setSystemTime(Date.now() + 61000);
    await processRefundJobs(env);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get("Idempotency-Key"));
    expect(keys).toEqual(["refund-pi_refund", "refund-pi_refund"]);
    expect((await getOrderById(env, "refund"))?.payment_status).toBe("refunded");
    expect(await processRefundJobs(env)).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM payment_refunds").get()?.n).toBe(1);
    sqlite.close();
  });

  it("retrieves a pending refund by its stored ID instead of submitting another", async () => {
    vi.useFakeTimers();
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("pending", { payment_status: "paid", ai_status: "failed", generation_count: 1,
      stripe_payment_intent_id: "pi_pending", refund_requested_at: new Date().toISOString() });
    const refund = { id: "re_pending", status: "pending", amount: 89000, currency: "huf", payment_intent: "pi_pending" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(refund)).mockResolvedValueOnce(Response.json({ ...refund, status: "succeeded" }));
    vi.stubGlobal("fetch", fetchMock);
    await processRefundJobs(env);
    expect((await getOrderById(env, "pending"))?.payment_status).toBe("paid");
    vi.setSystemTime(Date.now() + 301000);
    await processRefundJobs(env);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.stripe.com/v1/refunds/re_pending");
    expect((await getOrderById(env, "pending"))?.payment_status).toBe("refunded");
    sqlite.close();
  });

  it("requires reconciliation when an unknown refund result is older than the idempotency guarantee", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("old", { payment_status: "paid", ai_status: "failed", generation_count: 1,
      stripe_payment_intent_id: "pi_old", refund_requested_at: new Date(Date.now() - 21 * 3600000).toISOString() });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await processRefundJobs(env);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getOrderById(env, "old"))?.refund_manual_required).toBe(1);
    sqlite.close();
  });

  it("recovers pending invoices and enforces retry dates", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("invoice", { payment_status: "paid", invoice_status: "pending" });
    addOrder("later", { payment_status: "paid", invoice_status: "retry_required", invoice_next_retry_at: new Date(Date.now() + 60000).toISOString() });
    expect((await getInvoiceRetryCandidates(env)).map((o) => o.id)).toEqual(["invoice"]);
    sqlite.close();
  });

  it("forbids generation after retention and repeatedly clears any reintroduced content", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    addOrder("expired", { created_at: new Date(Date.now() - 100 * 86400000).toISOString(), payment_status: "paid", ai_status: "completed", generation_count: 1, generated_letter: "Expired" });
    expect(await beginRegeneration(env, "expired", 3)).toBe(false);
    await cleanupExpiredData(env);
    expect(canRequestRegeneration((await getOrderById(env, "expired"))!, 3)).toBe(false);
    sqlite.prepare("UPDATE orders SET generated_letter = 'reintroduced', generation_feedback = 'private'").run();
    await cleanupExpiredData(env);
    expect((await getOrderById(env, "expired"))?.generated_letter).toBeNull();
    expect((await getOrderById(env, "expired"))?.generation_feedback).toBeNull();
    expect(await beginGeneration(env, "expired")).toBe(false);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
});
