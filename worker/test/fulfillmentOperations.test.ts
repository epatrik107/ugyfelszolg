import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginRegeneration,
  cleanupExpiredData,
  getInvoiceRetryCandidates,
  getOrderById,
  GENERATION_RETRY_DELAYS_MINUTES,
} from "../src/lib/db";
import { checkAiServiceAvailable } from "../src/lib/health";
import { hashToken } from "../src/lib/hash";
import { processGenerationJobs, processRefundJobs } from "../src/lib/jobs";
import { collectOperatorIssues, processOperatorRequests, queueOperatorDigest } from "../src/lib/ops";
import { enqueueEmail, processEmailOutbox } from "../src/lib/outbox";
import { getOrderResultRoute } from "../src/routes/getOrderResult";
import { orderAccessLinkRoute } from "../src/routes/orderAccessLink";
import { regenerateOrderRoute } from "../src/routes/regenerateOrder";
import type { Env, OrderRow } from "../src/lib/types";
import { sqliteEnv } from "./helpers/sqlite";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const LETTER = "Tárgy: Panasz\n\nTisztelt Ügyfélszolgálat!\n\nKérem a hibás szolgáltatás kijavítását, mert a megrendelt csomag nem érkezett meg.\n\nÜdvözlettel:\nTeszt Elek";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function emailEnv(env: Env) {
  return { ...env, RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Levélsegéd <noreply@example.com>", OPERATOR_EMAIL: "ops@example.com" } as Env;
}

/** Orders get a real capability token so emails can be verified end to end. */
async function paidOrder(env: Env, addOrder: (id: string, overrides?: Partial<OrderRow>) => void, id: string, overrides: Partial<OrderRow> = {}) {
  const token = await hashToken(`checkout-result:${id}`, env.TOKEN_HASH_SECRET);
  addOrder(id, { payment_status: "paid", result_token_hash: await hashToken(token, env.TOKEN_HASH_SECRET), stripe_payment_intent_id: `pi_${id}`, ...overrides });
  return token;
}

function geminiText(text: string) {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

describe("transactional email outbox", () => {
  it("sends the order confirmation with a working capability link and never stores the token", async () => {
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    const token = await paidOrder(env, addOrder, "order_ok");
    await enqueueEmail(env, { kind: "order_confirmation", dedupeKey: "order-confirmation:order_ok", orderId: "order_ok" });
    expect(await enqueueEmail(env, { kind: "order_confirmation", dedupeKey: "order-confirmation:order_ok", orderId: "order_ok" })).toBe(false);
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM email_outbox").all())).not.toContain(token);

    const requests: Array<{ headers: Record<string, string>; body: { to: string[]; html: string } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return Response.json({ id: "email_1" });
    }));
    expect(await processEmailOutbox(env)).toEqual({ claimed: 1, sent: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.to).toEqual(["kapcsolat@example.com"]);
    expect(requests[0].headers["Idempotency-Key"]).toBe("outbox-order-confirmation:order_ok");
    expect(requests[0].body.html).toContain(`sikeres-fizetes?order=order_ok#token=${token}`);
    expect(sqlite.prepare("SELECT status, payload FROM email_outbox").get()).toEqual({ status: "sent", payload: null });
    sqlite.close();
  });

  it("retries transient provider failures with backoff and dead-letters permanent ones", async () => {
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0; });
    await paidOrder(env, addOrder, "retry_me");
    await paidOrder(env, addOrder, "bad_address");
    await enqueueEmail(env, { kind: "order_confirmation", dedupeKey: "c:retry_me", orderId: "retry_me" });
    await enqueueEmail(env, { kind: "order_confirmation", dedupeKey: "c:bad_address", orderId: "bad_address" });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      return new Response("{}", { status: key.includes("bad_address") ? 422 : 429 });
    }));
    await processEmailOutbox(env);
    const rows = sqlite.prepare("SELECT dedupe_key, status, attempts, next_attempt_at, last_error FROM email_outbox ORDER BY dedupe_key").all() as Array<Record<string, string | number>>;
    expect(rows[0]).toMatchObject({ dedupe_key: "c:bad_address", status: "dead", last_error: "resend_422" });
    expect(rows[1]).toMatchObject({ dedupe_key: "c:retry_me", status: "pending", attempts: 1, last_error: "resend_429" });
    expect(Date.parse(String(rows[1].next_attempt_at))).toBeGreaterThan(Date.now() + 30_000);
    // Not due yet: nothing is resent early.
    expect((await processEmailOutbox(env)).claimed).toBe(0);
    sqlite.close();
  });

  it("recovers a message whose sender crashed mid-delivery", async () => {
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    await paidOrder(env, addOrder, "crashed");
    await enqueueEmail(env, { kind: "order_confirmation", dedupeKey: "c:crashed", orderId: "crashed" });
    sqlite.prepare("UPDATE email_outbox SET status = 'sending', claimed_at = ?, attempts = 1").run(new Date(Date.now() - 11 * 60_000).toISOString());
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "email_2" })));
    expect(await processEmailOutbox(env)).toEqual({ claimed: 1, sent: 1 });
    sqlite.close();
  });
});

describe("self-service order link recovery", () => {
  async function post(env: Env, body: unknown, ip = "203.0.113.1") {
    const app = new Hono<{ Bindings: Env }>();
    app.post("/access-link", orderAccessLinkRoute);
    return app.fetch(new Request("https://worker.test/access-link", {
      method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    }), env, ctx);
  }

  it("answers identically for known and unknown addresses and only mails the order owner", async () => {
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    const token = await paidOrder(env, addOrder, "mine", { email: "vevo@example.com" });
    addOrder("unpaid", { email: "vevo@example.com", payment_status: "checkout_created" });
    const sentTo: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("turnstile")) return Response.json({ success: true, hostname: "example.com", action: "access_link" });
      const body = JSON.parse(String(init.body));
      sentTo.push(body.to[0]);
      expect(body.html).toContain(`order=mine#token=${token}`);
      expect(body.html).not.toContain("unpaid");
      return Response.json({ id: "email_3" });
    }));
    const known = await post(env, { email: "VEVO@example.com", turnstileToken: "ok" });
    const unknown = await post(env, { email: "nincs@example.com", turnstileToken: "ok" }, "203.0.113.2");
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    await processEmailOutbox(env);
    expect(sentTo).toEqual(["vevo@example.com"]);
    sqlite.close();
  });

  it("requires Turnstile and rate limits verified requests per email address", async () => {
    const { env: base, sqlite } = sqliteEnv();
    const env = emailEnv(base);
    let turnstileOk = false;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(turnstileOk
      ? { success: true, hostname: "example.com", action: "access_link" }
      : { success: false })));
    expect((await post(env, { email: "a@example.com", turnstileToken: "bad" })).status).toBe(400);
    expect((await post(env, { email: "a@example.com" })).status).toBe(400);
    // Failed challenges do not consume the victim's per-email allowance.
    for (let i = 0; i < 5; i += 1) await post(env, { email: "b@example.com", turnstileToken: "bad" }, `198.51.100.${i}`);
    turnstileOk = true;
    for (let i = 0; i < 3; i += 1) expect((await post(env, { email: "b@example.com", turnstileToken: "ok" }, `192.0.2.${i}`)).status).toBe(200);
    expect((await post(env, { email: "b@example.com", turnstileToken: "ok" }, "192.0.2.9")).status).toBe(429);
    sqlite.close();
  });
});

describe("durable AI fulfillment", () => {
  it("retries a Gemini outage across scheduled runs, then fails once and refunds without an invoice", async () => {
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0; });
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    await paidOrder(env, addOrder, "outage", { ai_status: "not_started", invoice_status: "pending" });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(":generateContent")) return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 });
      if (url.includes("/v1/refunds")) return Response.json({ id: "re_outage", payment_intent: "pi_outage", status: "succeeded", amount: 89000, currency: "huf" });
      return Response.json({ id: "email" });
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let run = 0; run < GENERATION_RETRY_DELAYS_MINUTES.length; run += 1) {
      await processGenerationJobs(env);
      const order = (await getOrderById(env, "outage"))!;
      expect(order).toMatchObject({ ai_status: "generating", generation_retry_count: run + 1, refund_requested_at: null });
      // Not due before its backoff; due afterwards.
      expect(await processGenerationJobs(env)).toBe(0);
      sqlite.prepare("UPDATE orders SET generation_next_attempt_at = ?").run(new Date(Date.now() - 1000).toISOString());
    }
    expect(await checkAiServiceAvailable(env)).toBe(false);

    await processGenerationJobs(env);
    const failed = (await getOrderById(env, "outage"))!;
    expect(failed).toMatchObject({ ai_status: "failed", refund_reason: "generation_failed", generation_retry_count: 0 });
    expect(await getInvoiceRetryCandidates(env)).toEqual([]);

    await processRefundJobs(env);
    const refunded = (await getOrderById(env, "outage"))!;
    expect(refunded).toMatchObject({ payment_status: "refunded", invoice_status: "not_required", refund_invoice_status: "not_required" });
    expect(sqlite.prepare("SELECT kind FROM email_outbox").all()).toEqual([{ kind: "refund_notice" }]);
    sqlite.close();
  });

  it("recovers after an outage: completes the letter, clears the circuit breaker and only then invoices", async () => {
    vi.stubGlobal("setTimeout", (fn: () => void) => { fn(); return 0; });
    const { env, sqlite, addOrder } = sqliteEnv();
    await paidOrder(env, addOrder, "recovered", { ai_status: "not_started", invoice_status: "pending" });
    let outage = true;
    let modelCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.endsWith(":generateContent")) return Response.json({});
      if (outage) return new Response("{}", { status: 429 });
      modelCalls += 1;
      // Generation, then the independent review.
      return modelCalls % 2 === 1 ? geminiText(LETTER) : geminiText('{"ok":true,"issues":[]}');
    }));
    await processGenerationJobs(env);
    expect((await getOrderById(env, "recovered"))!.generation_retry_count).toBe(1);
    expect(await getInvoiceRetryCandidates(env)).toEqual([]);

    outage = false;
    sqlite.prepare("UPDATE orders SET generation_next_attempt_at = ?").run(new Date(Date.now() - 1000).toISOString());
    await processGenerationJobs(env);
    const done = (await getOrderById(env, "recovered"))!;
    expect(done).toMatchObject({ ai_status: "completed", generation_retry_count: 0, generated_letter: LETTER, refund_requested_at: null });
    expect((await getInvoiceRetryCandidates(env)).map((order) => order.id)).toEqual(["recovered"]);
    expect(sqlite.prepare("SELECT consecutive_failures FROM ai_provider_health").get()).toEqual({ consecutive_failures: 0 });
    sqlite.close();
  });

  it("blocks new checkouts while recent real generation calls keep failing", async () => {
    const { env, sqlite } = sqliteEnv();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    expect(await checkAiServiceAvailable(env)).toBe(true);
    sqlite.prepare("INSERT INTO ai_provider_health (id, consecutive_failures, last_failure_at) VALUES ('gemini', 3, ?)").run(new Date().toISOString());
    expect(await checkAiServiceAvailable(env)).toBe(false);
    sqlite.prepare("UPDATE ai_provider_health SET last_failure_at = ?").run(new Date(Date.now() - 11 * 60_000).toISOString());
    expect(await checkAiServiceAvailable(env)).toBe(true);
    sqlite.close();
  });

  it("caps total modification requests even though failed ones restore the allowance", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    const token = await paidOrder(env, addOrder, "regen", { ai_status: "completed", generation_count: 1, generated_letter: LETTER, regeneration_request_count: 6 });
    expect(await beginRegeneration(env, "regen", 1)).toBe(false);
    const app = new Hono<{ Bindings: Env }>();
    app.post("/orders/:publicId/regenerate", regenerateOrderRoute);
    const response = await app.fetch(new Request("https://worker.test/orders/regen/regenerate", {
      method: "POST", body: JSON.stringify({ feedback: "Legyen rövidebb." }),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.10" },
    }), env, ctx);
    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("REGENERATION_LIMIT");
    sqlite.prepare("UPDATE orders SET regeneration_request_count = 5").run();
    expect(await beginRegeneration(env, "regen", 1)).toBe(true);
    sqlite.close();
  });
});

describe("customer-visible refund and retry state", () => {
  async function result(env: Env, id: string, token: string) {
    const app = new Hono<{ Bindings: Env }>();
    app.get("/orders/:publicId/result", getOrderResultRoute);
    const response = await app.fetch(new Request(`https://worker.test/orders/${id}/result`, { headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    return (await response.json() as { data: Record<string, unknown> }).data;
  }

  it("reports manual refund review and scheduled AI retries truthfully", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    const manual = await paidOrder(env, addOrder, "manual", { ai_status: "failed", refund_requested_at: new Date().toISOString(), refund_manual_required: 1 });
    const retrying = await paidOrder(env, addOrder, "retrying", { ai_status: "generating", generation_count: 1, generation_retry_count: 2 });
    expect(await result(env, "manual", manual)).toMatchObject({ refundStatus: "manual_review" });
    expect(await result(env, "retrying", retrying)).toMatchObject({ generationRetryScheduled: true, refundStatus: null });
    sqlite.close();
  });
});

describe("operator visibility and actions", () => {
  it("alerts on money-affecting states once per unchanged set and immediately on a new problem", async () => {
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    addOrder("storno", { payment_status: "refunded", refund_invoice_status: "manual_required" });
    addOrder("manual", { payment_status: "paid", refund_manual_required: 1 });
    const issues = await collectOperatorIssues(env);
    expect(issues.map((issue) => issue.key)).toEqual(["manual_refund", "storno_required"]);
    expect((await queueOperatorDigest(env)).queued).toBe(true);
    expect((await queueOperatorDigest(env)).queued).toBe(false);
    addOrder("dispute", { payment_status: "chargeback_open" });
    expect((await queueOperatorDigest(env)).queued).toBe(true);

    const mails: Array<{ to: string[]; subject: string; html: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { mails.push(JSON.parse(String(init.body))); return Response.json({ id: "ops" }); }));
    await processEmailOutbox(env);
    expect(mails.every((mail) => mail.to[0] === "ops@example.com")).toBe(true);
    expect(mails.at(-1)!.html).toContain("chargeback");
    sqlite.close();
  });

  it("executes validated operator requests and never creates a refund Stripe already has", async () => {
    const { env: base, sqlite, addOrder } = sqliteEnv();
    const env = emailEnv(base);
    addOrder("storno", { payment_status: "refunded", refund_invoice_status: "manual_required" });
    await paidOrder(env, addOrder, "manual", { ai_status: "failed", refund_requested_at: new Date(Date.now() - 30 * 3600_000).toISOString(), refund_manual_required: 1 });
    await paidOrder(env, addOrder, "requeue", { ai_status: "failed", refund_requested_at: new Date().toISOString() });
    const insert = sqlite.prepare("INSERT INTO operator_requests (id, action, public_id, argument, requested_by, created_at) VALUES (?, ?, ?, ?, 'tester', ?)");
    insert.run("r1", "mark_storno_done", "storno", "E-STORNO-2026-1", new Date().toISOString());
    insert.run("r2", "retry_refund", "manual", null, new Date().toISOString());
    insert.run("r3", "requeue_generation", "requeue", null, new Date().toISOString());
    insert.run("r4", "mark_storno_done", "storno", "bad value; DROP", new Date().toISOString());
    expect(() => insert.run("r5", "drop_database", "storno", null, new Date().toISOString())).toThrow();

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "re_existing", payment_intent: "pi_manual", status: "succeeded", amount: 89000, currency: "huf" }] })));
    await processOperatorRequests(env);
    const results = Object.fromEntries((sqlite.prepare("SELECT id, status, result FROM operator_requests").all() as Array<{ id: string; status: string; result: string }>)
      .map((row) => [row.id, `${row.status}:${row.result}`]));
    expect(results).toEqual({
      r1: "done:storno_recorded",
      r2: "failed:refund_exists_use_reconcile_refund",
      r3: "done:generation_requeued",
      r4: "failed:invalid_storno_number",
    });
    expect((await getOrderById(env, "storno"))).toMatchObject({ refund_invoice_status: "created", storno_invoice_number: "E-STORNO-2026-1" });
    expect((await getOrderById(env, "manual"))!.refund_manual_required).toBe(1);
    expect((await getOrderById(env, "requeue"))).toMatchObject({ ai_status: "generating", refund_requested_at: null });

    insert.run("r6", "reconcile_refund", "manual", null, new Date().toISOString());
    await processOperatorRequests(env);
    expect((await getOrderById(env, "manual"))).toMatchObject({ payment_status: "refunded", refund_manual_required: 0, refund_stripe_id: "re_existing" });
    sqlite.close();
  });

  it("keeps money-bearing orders through retention while deleting abandoned ones", async () => {
    const { env, sqlite, addOrder } = sqliteEnv();
    const old = new Date(Date.now() - 91 * 86400000).toISOString();
    addOrder("abandoned", { payment_status: "expired", created_at: old });
    addOrder("chargeback", { payment_status: "chargeback_lost", created_at: old });
    addOrder("mismatch", { payment_status: "amount_mismatch", created_at: old });
    await cleanupExpiredData(env);
    expect(await getOrderById(env, "abandoned")).toBeNull();
    expect(await getOrderById(env, "chargeback")).not.toBeNull();
    expect(await getOrderById(env, "mismatch")).not.toBeNull();
    sqlite.close();
  });
});

describe("operator email configuration", () => {
  it("accepts plain addresses and rejects display names, spaces and malformed domains in linear time", async () => {
    const { isPlainEmailAddress } = await import("../src/lib/envValidation");
    expect(isPlainEmailAddress("ugyfelszolgalat2026@gmail.com")).toBe(true);
    for (const value of ["Ops <ops@example.com>", "ops@example", "ops@@example.com", "o ps@example.com", "@example.com", "ops@example."]) {
      expect(isPlainEmailAddress(value)).toBe(false);
    }
    const started = performance.now();
    isPlainEmailAddress(`!@!.${"!.".repeat(50_000)}`);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
