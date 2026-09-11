import { Hono } from "hono";
import { addSecurityHeaders, bodySizeGuard, corsGuard, requireJsonContentType } from "./lib/security";
import { cleanupExpiredData } from "./lib/db";
import { processGenerationJobs, processRefundJobs } from "./lib/jobs";
import {
  envValidationGuard,
  logEnvValidationFailure,
  validateEnv,
} from "./lib/envValidation";
import { retryDueInvoices } from "./lib/invoice";
import { logEvent } from "./lib/logger";
import { errorJson } from "./lib/response";
import type { Env } from "./lib/types";
import { contactRoute } from "./routes/contact";
import { cancelCheckoutSessionRoute } from "./routes/cancelCheckoutSession";
import { createCheckoutSessionRoute } from "./routes/createCheckoutSession";
import { getOrderResultRoute } from "./routes/getOrderResult";
import { regenerateOrderRoute } from "./routes/regenerateOrder";
import { sendLetterRoute } from "./routes/sendLetter";
import { stripeWebhookRoute } from "./routes/stripeWebhook";
import {
  adminInvoiceStatusRoute,
  adminRetryInvoiceEmailRoute,
  adminRetryInvoiceRoute,
} from "./routes/adminInvoice";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsGuard);
app.use("/api/*", bodySizeGuard);
app.use("/api/*", requireJsonContentType);
app.use("/api/*", envValidationGuard);
app.post("/api/create-checkout-session", createCheckoutSessionRoute);
app.post("/api/stripe/webhook", stripeWebhookRoute);
app.post("/api/orders/:publicId/cancel-checkout", cancelCheckoutSessionRoute);
app.get("/api/orders/:publicId/result", getOrderResultRoute);
app.post("/api/orders/:publicId/regenerate", regenerateOrderRoute);
app.post("/api/orders/:publicId/send-letter", sendLetterRoute);
app.post("/api/contact", contactRoute);
app.get("/api/admin/orders/:publicId/invoice", adminInvoiceStatusRoute);
app.post("/api/admin/orders/:publicId/invoice/retry", adminRetryInvoiceRoute);
app.post("/api/admin/orders/:publicId/invoice/email/retry", adminRetryInvoiceEmailRoute);
app.get("/api/health", async (c) => {
  const validation = validateEnv(c.env);
  logEnvValidationFailure(validation, "health");

  try {
    await c.env.DB.batch([
      c.env.DB.prepare("SELECT generation_run_id, refund_requested_at, refund_manual_required FROM orders LIMIT 0"),
      c.env.DB.prepare("SELECT key, count, expires_at FROM rate_limits LIMIT 0"),
      c.env.DB.prepare("SELECT id FROM invoices LIMIT 0"),
    ]);
    const status = validation.ok ? "ok" : "degraded";
    return c.json({ status, revision: c.env.BUILD_SHA ?? "local", schemaVersion: 13, ts: new Date().toISOString() }, validation.ok ? 200 : 503);
  } catch {
    return c.json({ status: "degraded", ts: new Date().toISOString() }, 503);
  }
});
app.notFound((c) => errorJson(c, "NOT_FOUND", "Nem található.", 404));
app.onError((error, c) => {
  logEvent("unhandled_error", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    errorType: error instanceof Error ? error.name : "unknown",
  });
  return errorJson(c, "INTERNAL_ERROR", "Váratlan szerverhiba.", 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await app.fetch(request, env, ctx);
    return addSecurityHeaders(response);
  },
  async scheduled(controller: ScheduledController, env: Env) {
    const validation = validateEnv(env);
    if (!validation.ok) {
      logEnvValidationFailure(validation, "scheduled");
      return;
    }
    // Retention is daily; payment and generation recovery runs every minute.
    const scheduledTime = new Date(controller.scheduledTime ?? Date.now());
    if (scheduledTime.getUTCHours() === 2 && scheduledTime.getUTCMinutes() === 17) {
      try { await cleanupExpiredData(env); }
      catch { logEvent("cron_cleanup_failed", {}); }
    }
    try {
      await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?")
        .bind(Math.floor(Date.now() / 1000)).run();
    } catch { logEvent("cron_rate_limit_cleanup_failed", {}); }
    // A provider outage must not prevent the other job classes from running.
    await Promise.all([
      (async () => {
        try { await processGenerationJobs(env); }
        catch { logEvent("cron_generation_scan_failed", {}); }
        try { await processRefundJobs(env); }
        catch { logEvent("cron_refund_scan_failed", {}); }
      })(),
      (async () => {
        try {
          for (const retry of await retryDueInvoices(env)) logEvent("invoice_retry_finished", retry);
        } catch { logEvent("cron_invoice_retry_failed", {}); }
      })(),
    ]);
  },
};
