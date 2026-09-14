import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileOpenCheckouts } from "../src/lib/checkoutCompletion";
import { getOrderById } from "../src/lib/db";
import { hashToken } from "../src/lib/hash";
import { processRefundJobs } from "../src/lib/jobs";
import { processEmailOutbox } from "../src/lib/outbox";
import { stripeWebhookRoute } from "../src/routes/stripeWebhook";
import type { Env, OrderRow } from "../src/lib/types";
import { sqliteEnv } from "./helpers/sqlite";

// Real SQL, real signature verification and real state transitions. Only the
// Stripe, Resend and Szamlazz HTTP APIs are stubbed.
const WEBHOOK_SECRET = "whsec_integration_secret";
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function sign(body: string, secret = WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${signature}`;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1", url: null, mode: "payment", status: "complete", payment_status: "paid",
    amount_total: 89000, currency: "huf", customer: null, customer_details: { email: "szamla@example.com" },
    payment_intent: "pi_test_1", subscription: null, client_reference_id: "order_1",
    metadata: { orderId: "order_1", publicId: "order_1", selectedPackage: "basic" },
    ...overrides,
  };
}

function setup(orderOverrides: Partial<OrderRow> = {}) {
  const { env: base, sqlite, addOrder } = sqliteEnv();
  const env = { ...base, PAYMENTS_ENABLED: "true", PAYMENT_MODE: "test", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Levélsegéd <noreply@example.com>" } as Env;
  addOrder("order_1", { payment_status: "checkout_created", stripe_session_id: "cs_test_1", billing_email: "szamla@example.com", ...orderOverrides });
  const stripe = {
    session: session() as Record<string, unknown>,
    refund: { id: "re_1", payment_intent: "pi_test_1", status: "succeeded", amount: 89000, currency: "huf" } as Record<string, unknown>,
    dispute: { id: "dp_1", charge: "ch_1", payment_intent: "pi_test_1", amount: 89000, currency: "huf", reason: "fraudulent", status: "needs_response" } as Record<string, unknown>,
    sessionFailures: 0,
  };
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/v1/checkout/sessions/")) {
      if (stripe.sessionFailures > 0) { stripe.sessionFailures -= 1; return new Response("{}", { status: 500 }); }
      return Response.json(stripe.session);
    }
    if (url.includes("/v1/refunds")) return Response.json(stripe.refund);
    if (url.includes("/v1/disputes/")) return Response.json(stripe.dispute);
    if (url.includes("api.resend.com")) return Response.json({ id: "email_1" });
    throw new Error(`Unexpected outbound request ${url}`);
  }));
  async function deliver(type: string, object: Record<string, unknown>, id = "evt_1", options: { secret?: string; livemode?: boolean } = {}) {
    const body = JSON.stringify({ id, type, livemode: options.livemode ?? false, data: { object } });
    const app = new Hono<{ Bindings: Env }>();
    app.post("/webhook", stripeWebhookRoute);
    return app.fetch(new Request("https://worker.test/webhook", {
      method: "POST", body, headers: { "Stripe-Signature": await sign(body, options.secret) },
    }), env, ctx);
  }
  const order = async () => (await getOrderById(env, "order_1"))!;
  const outbox = () => sqlite.prepare("SELECT kind, status, dedupe_key FROM email_outbox ORDER BY created_at").all() as Array<{ kind: string; status: string; dedupe_key: string }>;
  const event = (id: string) => (sqlite.prepare("SELECT status FROM processed_stripe_events WHERE event_id = ?").get(id) as { status: string } | undefined)?.status;
  const anomalies = () => sqlite.prepare("SELECT reason, resolved_at FROM payment_anomalies").all() as Array<{ reason: string; resolved_at: string | null }>;
  return { env, sqlite, stripe, calls, deliver, order, outbox, event, anomalies };
}

describe("Stripe webhook business flow (real persistence)", () => {
  it("marks an exact payment paid once, activates generation, queues the access email and defers invoicing", async () => {
    const t = setup();
    const response = await t.deliver("checkout.session.completed", { id: "cs_test_1" });
    expect(response.status).toBe(200);
    const order = await t.order();
    expect(order).toMatchObject({ payment_status: "paid", ai_status: "generating", generation_count: 1, invoice_status: "pending", stripe_payment_intent_id: "pi_test_1", paid_amount: 890 });
    expect(t.outbox()).toEqual([{ kind: "order_confirmation", status: "pending", dedupe_key: "order-confirmation:order_1" }]);
    expect(t.calls.some((call) => call.includes("szamlazz"))).toBe(false);
    expect(t.event("evt_1")).toBe("completed");

    // A second event for the same session neither pays nor activates twice.
    expect((await t.deliver("checkout.session.async_payment_succeeded", { id: "cs_test_1" }, "evt_2")).status).toBe(200);
    expect(await t.order()).toMatchObject({ payment_status: "paid", generation_count: 1 });
    expect(t.outbox()).toHaveLength(1);
    t.sqlite.close();
  });

  it("acknowledges a duplicate event id without touching Stripe and asks Stripe to retry one still processing", async () => {
    const t = setup();
    await t.deliver("checkout.session.completed", { id: "cs_test_1" });
    const stripeCalls = t.calls.length;
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(200);
    expect(t.calls.length).toBe(stripeCalls);

    t.sqlite.prepare("INSERT INTO processed_stripe_events (event_id, event_type, status, processed_at, updated_at) VALUES ('evt_busy', 'checkout.session.completed', 'processing', ?, ?)")
      .run(new Date().toISOString(), new Date().toISOString());
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" }, "evt_busy")).status).toBe(409);
    t.sqlite.close();
  });

  it("returns 500 on a Stripe outage and completes the same event on redelivery", async () => {
    const t = setup();
    t.stripe.sessionFailures = 1;
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(500);
    expect(t.event("evt_1")).toBe("failed");
    expect((await t.order()).payment_status).toBe("checkout_created");
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(200);
    expect((await t.order()).payment_status).toBe("paid");
    t.sqlite.close();
  });

  it.each([
    ["amount_mismatch", { amount_total: 100 }],
    ["currency_mismatch", { currency: "eur" }],
  ])("keeps no charge silently on %s: records it and refunds automatically", async (status, override) => {
    const t = setup();
    Object.assign(t.stripe.session, override);
    t.stripe.refund = { ...t.stripe.refund, amount: (override as { amount_total?: number }).amount_total ?? 89000, currency: (override as { currency?: string }).currency ?? "huf" };
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(200);
    const mismatched = await t.order();
    expect(mismatched).toMatchObject({ payment_status: status, ai_status: "not_started", stripe_payment_intent_id: "pi_test_1", refund_reason: status });
    expect(mismatched.refund_requested_at).toBeTruthy();
    expect(t.anomalies()).toEqual([{ reason: status, resolved_at: null }]);

    await processRefundJobs(t.env);
    expect((await t.order()).payment_status).toBe("refunded");
    expect(t.calls.some((call) => call.startsWith("POST https://api.stripe.com/v1/refunds"))).toBe(true);
    expect(t.outbox().map((row) => row.kind)).toEqual(["refund_notice"]);
    t.sqlite.close();
  });

  it("fulfills a verified payment even when the Stripe receipt email differs from the billing email", async () => {
    const t = setup();
    t.stripe.session.customer_details = { email: "Other.Person@example.com" };
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(200);
    expect((await t.order()).payment_status).toBe("paid");
    t.sqlite.close();
  });

  it("fulfills a payment completed after a local cancel and keeps an audit record", async () => {
    const t = setup({ payment_status: "cancelled" });
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(200);
    expect((await t.order()).payment_status).toBe("paid");
    expect(t.anomalies()).toEqual([{ reason: "paid_after_local_cancel", resolved_at: expect.any(String) }]);
    t.sqlite.close();
  });

  it("records a paid session for an unknown order as an open anomaly", async () => {
    const t = setup();
    t.stripe.session.metadata = { orderId: "missing_order", selectedPackage: "basic" };
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" })).status).toBe(200);
    expect(t.anomalies()).toEqual([{ reason: "paid_unknown_order", resolved_at: null }]);
    t.sqlite.close();
  });

  it("delays the payment-failed email and skips it when the customer pays in the same session", async () => {
    const t = setup();
    const token = await hashToken("checkout-result:order_1", t.env.TOKEN_HASH_SECRET);
    t.sqlite.prepare("UPDATE orders SET result_token_hash = ?").run(await hashToken(token, t.env.TOKEN_HASH_SECRET));
    await t.deliver("payment_intent.payment_failed", { id: "pi_test_1", metadata: { orderId: "order_1" } });
    expect((await t.order()).payment_status).toBe("failed");
    await t.deliver("checkout.session.completed", { id: "cs_test_1" }, "evt_2");
    expect((await t.order()).payment_status).toBe("paid");
    t.sqlite.prepare("UPDATE email_outbox SET next_attempt_at = ?").run(new Date(Date.now() - 1000).toISOString());
    await processEmailOutbox(t.env);
    const rows = t.outbox();
    expect(rows.find((row) => row.kind === "payment_failed")?.status).toBe("skipped");
    expect(rows.find((row) => row.kind === "order_confirmation")?.status).toBe("sent");
    t.sqlite.close();
  });

  it("expires an abandoned checkout without activation", async () => {
    const t = setup();
    await t.deliver("checkout.session.expired", { id: "cs_test_1", metadata: { orderId: "order_1" } });
    expect(await t.order()).toMatchObject({ payment_status: "expired", ai_status: "not_started" });
    expect(t.outbox().map((row) => row.kind)).toEqual(["checkout_expired"]);
    t.sqlite.close();
  });

  it.each([
    [20000, 10000, false, "partially_refunded"],
    [20000, 20000, true, "refunded"],
  ])("tracks charge.refunded (%i/%i) and releases an unissued invoice on a full refund", async (amount, refunded, full, status) => {
    const t = setup({ payment_status: "paid", stripe_payment_intent_id: "pi_test_1", invoice_status: "pending" });
    await t.deliver("charge.refunded", { id: "ch_1", amount, amount_refunded: refunded, refunded: full, currency: "huf", payment_intent: "pi_test_1", metadata: { orderId: "order_1" } });
    const order = await t.order();
    expect(order.payment_status).toBe(status);
    expect(order.invoice_status).toBe(full ? "not_required" : "pending");
    expect(order.refund_invoice_status).toBe("not_required");
    expect(t.outbox().map((row) => row.kind)).toEqual(full ? ["refund_notice"] : []);
    t.sqlite.close();
  });

  it("requires a storno when a refunded order was already invoiced", async () => {
    const t = setup({ payment_status: "paid", stripe_payment_intent_id: "pi_test_1", invoice_status: "created" });
    await t.deliver("refund.updated", { id: "re_1" });
    expect(await t.order()).toMatchObject({ payment_status: "refunded", refund_invoice_status: "manual_required", invoice_status: "created" });
    t.sqlite.close();
  });

  it.each(["pending", "requires_action", "failed", "canceled"])("records a %s refund without settling or emailing it", async (refundStatus) => {
    const t = setup({ payment_status: "paid", stripe_payment_intent_id: "pi_test_1", paid_amount: 890 });
    t.stripe.refund.status = refundStatus;
    expect((await t.deliver("refund.updated", { id: "re_1" })).status).toBe(200);
    expect(await t.order()).toMatchObject({ payment_status: "paid", stripe_refund_status: refundStatus });
    expect(t.outbox()).toEqual([]);
    t.sqlite.close();
  });

  it.each([
    ["needs_response", "chargeback_open"],
    ["lost", "chargeback_lost"],
    ["warning_needs_response", "paid"],
    ["warning_closed", "paid"],
    ["prevented", "paid"],
  ])("reads dispute %s from Stripe and records payment status %s", async (disputeStatus, paymentStatus) => {
    const t = setup({ payment_status: "paid", stripe_payment_intent_id: "pi_test_1", ai_status: "completed", generated_letter: "Kész levél." });
    t.stripe.dispute.status = disputeStatus;
    // The payload status is deliberately stale: the handler must use Stripe's current object.
    expect((await t.deliver("charge.dispute.updated", { id: "dp_1", status: "needs_response" })).status).toBe(200);
    expect((await t.order()).payment_status).toBe(paymentStatus);
    expect(t.sqlite.prepare("SELECT status FROM payment_disputes").get()).toEqual({ status: disputeStatus });
    t.sqlite.close();
  });

  it("rejects an invalid signature or mismatched mode before claiming the event", async () => {
    const t = setup();
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" }, "evt_bad", { secret: "whsec_wrong" })).status).toBe(400);
    expect((await t.deliver("checkout.session.completed", { id: "cs_test_1" }, "evt_live", { livemode: true })).status).toBe(400);
    expect(t.event("evt_bad")).toBeUndefined();
    expect(t.event("evt_live")).toBeUndefined();
    expect(t.calls).toEqual([]);
    t.sqlite.close();
  });
});

describe("checkout reconciliation without a webhook", () => {
  const old = () => new Date(Date.now() - 15 * 60_000).toISOString();

  it("marks a paid session paid, activates it once and throttles the next check", async () => {
    const t = setup({ created_at: old() });
    expect(await reconcileOpenCheckouts(t.env)).toEqual({ checked: 1, paid: 1 });
    expect(await t.order()).toMatchObject({ payment_status: "paid", ai_status: "generating" });
    expect(t.outbox().map((row) => row.kind)).toEqual(["order_confirmation"]);
    expect(await reconcileOpenCheckouts(t.env)).toEqual({ checked: 0, paid: 0 });
    t.sqlite.close();
  });

  it("leaves open sessions untouched, expires expired ones, ignores fresh orders and disabled payments", async () => {
    const t = setup({ created_at: old() });
    t.stripe.session = session({ status: "open", payment_status: "unpaid" });
    expect(await reconcileOpenCheckouts(t.env)).toEqual({ checked: 1, paid: 0 });
    expect((await t.order()).payment_status).toBe("checkout_created");

    t.sqlite.prepare("UPDATE orders SET reconcile_checked_at = NULL").run();
    t.stripe.session = session({ status: "expired", payment_status: "unpaid" });
    await reconcileOpenCheckouts(t.env);
    expect((await t.order()).payment_status).toBe("expired");

    const fresh = setup();
    expect(await reconcileOpenCheckouts(fresh.env)).toEqual({ checked: 0, paid: 0 });
    expect(await reconcileOpenCheckouts({ ...fresh.env, PAYMENTS_ENABLED: "false" })).toEqual({ checked: 0, paid: 0 });
    t.sqlite.close();
    fresh.sqlite.close();
  });
});
