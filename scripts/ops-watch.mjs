// Independent production watchdog run by GitHub Actions. It does not depend on
// the Worker's own email alerts: a failing run notifies through GitHub.
// Prints identifiers and counts only, never customer data or secret values.
import { fileURLToPath } from "node:url";
import { d1Client } from "./lib/d1-rest.mjs";

export const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
];

export function checkStripeWebhookEndpoints(endpoints, expectedUrl) {
  const matches = endpoints.filter((endpoint) => endpoint.url === expectedUrl);
  if (matches.length === 0) return [`No Stripe webhook endpoint targets ${expectedUrl}.`];
  const enabled = matches.filter((endpoint) => endpoint.status === "enabled");
  if (enabled.length === 0) return [`The Stripe webhook endpoint for ${expectedUrl} is disabled.`];
  const problems = [];
  for (const endpoint of enabled) {
    const events = new Set(endpoint.enabled_events ?? []);
    const missing = events.has("*") ? [] : REQUIRED_STRIPE_EVENTS.filter((event) => !events.has(event));
    if (missing.length > 0) problems.push(`Stripe webhook ${endpoint.id} is missing events: ${missing.join(", ")}.`);
  }
  if (enabled.length > 1) problems.push(`${enabled.length} enabled Stripe endpoints target the same URL; each has its own signing secret.`);
  return problems;
}

export function evaluateOpsState({ now, heartbeatAt, undeliveredAlerts, oldFailedWebhooks }) {
  const problems = [];
  if (!heartbeatAt) problems.push("The scheduled Worker has never recorded a heartbeat.");
  else if (now - Date.parse(heartbeatAt) > 10 * 60_000) {
    problems.push(`The scheduled Worker has not run since ${heartbeatAt}; generation, refunds, invoices and emails are stalled.`);
  }
  if (undeliveredAlerts > 0) problems.push(`${undeliveredAlerts} operator alert email(s) could not be delivered.`);
  if (oldFailedWebhooks > 0) problems.push(`${oldFailedWebhooks} Stripe webhook event(s) have been failing for over an hour.`);
  return problems;
}

async function listStripeWebhookEndpoints(secretKey, fetchImpl = fetch) {
  const response = await fetchImpl("https://api.stripe.com/v1/webhook_endpoints?limit=100", {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Stripe webhook endpoint listing failed (HTTP ${response.status}).`);
  return (await response.json()).data ?? [];
}

export async function run(env = process.env) {
  const problems = [];
  const now = Date.now();
  const healthUrl = String(env.API_HEALTH_URL ?? "");

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
    const payload = await response.json().catch(() => null);
    if (response.status !== 200 || payload?.status !== "ok") {
      problems.push(`API health is ${response.status}/${payload?.status ?? "invalid"}.`);
    } else {
      console.log(`API health ok (revision ${String(payload.revision).slice(0, 12)}, schema ${payload.schemaVersion}).`);
    }
  } catch (error) {
    problems.push(`API health request failed: ${error instanceof Error ? error.message : "unknown"}.`);
  }

  try {
    const query = d1Client();
    const [heartbeat] = await query("SELECT last_run_at FROM ops_heartbeat WHERE name = 'scheduled'");
    const [alerts] = await query(
      `SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'operator_digest'
       AND (status = 'dead' OR (status IN ('pending', 'sending') AND created_at < ?)) AND created_at > ?`,
      [new Date(now - 30 * 60_000).toISOString(), new Date(now - 7 * 86400_000).toISOString()],
    );
    const [webhooks] = await query(
      "SELECT COUNT(*) AS n FROM processed_stripe_events WHERE status IN ('failed', 'processing') AND updated_at < ?",
      [new Date(now - 3600_000).toISOString()],
    );
    problems.push(...evaluateOpsState({
      now,
      heartbeatAt: heartbeat?.last_run_at ?? null,
      undeliveredAlerts: Number(alerts?.n ?? 0),
      oldFailedWebhooks: Number(webhooks?.n ?? 0),
    }));

    const summary = await query(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE refund_manual_required = 1 AND payment_status IN ('paid', 'amount_mismatch', 'currency_mismatch')) AS manual_refunds,
         (SELECT COUNT(*) FROM orders WHERE refund_invoice_status = 'manual_required') AS storno_required,
         (SELECT COUNT(*) FROM orders WHERE payment_status = 'paid' AND invoice_status = 'failed') AS invoices_failed,
         (SELECT COUNT(*) FROM orders WHERE payment_status = 'chargeback_open') AS chargebacks_open,
         (SELECT COUNT(*) FROM payment_anomalies WHERE resolved_at IS NULL) AS payment_anomalies,
         (SELECT COUNT(*) FROM orders WHERE ai_status = 'generating' AND generation_retry_count > 0) AS generations_retrying,
         (SELECT COUNT(*) FROM email_outbox WHERE status = 'pending') AS emails_pending`,
    );
    console.log(`Open operational items: ${JSON.stringify(summary[0])}`);
  } catch (error) {
    problems.push(`D1 operational check failed: ${error instanceof Error ? error.message : "unknown"}.`);
  }

  if (env.STRIPE_SECRET_KEY) {
    try {
      const expectedUrl = `${new URL(healthUrl).origin}/api/stripe/webhook`;
      const endpointProblems = checkStripeWebhookEndpoints(await listStripeWebhookEndpoints(env.STRIPE_SECRET_KEY), expectedUrl);
      problems.push(...endpointProblems);
      if (endpointProblems.length === 0) console.log(`Stripe webhook endpoint enabled for ${expectedUrl} with all required events.`);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "Stripe webhook check failed.");
    }
  }

  for (const problem of problems) console.error(`✗ ${problem}`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run();
}
