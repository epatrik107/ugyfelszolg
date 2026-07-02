import { Hono } from "hono";
import { addSecurityHeaders, bodySizeGuard, corsGuard, requireJsonContentType } from "./lib/security";
import {
  cleanupExpiredData,
  failGeneration,
  getStuckGeneratingOrders,
  markOrderPaymentStatus,
} from "./lib/db";
import { sendRefundEmail } from "./lib/email";
import {
  envValidationGuard,
  logEnvValidationFailure,
  validateEnv,
} from "./lib/envValidation";
import { getInvoiceByOrderId, retryDueInvoices } from "./lib/invoice";
import { logEvent } from "./lib/logger";
import { errorJson } from "./lib/response";
import { createRefund, fromStripeMinorAmount } from "./lib/stripe";
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
    await c.env.DB.prepare("SELECT 1").run();
    const status = validation.ok ? "ok" : "degraded";
    return c.json({ status, ts: new Date().toISOString() }, validation.ok ? 200 : 503);
  } catch {
    return c.json({ status: "degraded", ts: new Date().toISOString() }, 503);
  }
});
app.notFound((c) => errorJson(c, "NOT_FOUND", "Nem található.", 404));
app.onError((error, c) => {
  logEvent("unhandled_error", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    message: error instanceof Error ? error.message : "unknown",
  });
  return errorJson(c, "INTERNAL_ERROR", "Váratlan szerverhiba.", 500);
});

async function resolveStuckOrders(env: Env) {
  const stuckOrders = await getStuckGeneratingOrders(env);
  if (stuckOrders.length === 0) return;

  logEvent("cron_stuck_orders_found", { count: stuckOrders.length });

  for (const order of stuckOrders) {
    try {
      const failureRecorded = await failGeneration(
        env,
        order.id,
        "failed",
        "Automatikusan lezárva: generálás időtúllépés.",
        order.subscription_id,
      );
      if (!failureRecorded) {
        logEvent("stuck_order_state_unchanged", { orderId: order.id });
        continue;
      }

      logEvent("stuck_order_resolved", { orderId: order.id });

      if (order.stripe_payment_intent_id && order.billing_source === "checkout") {
        const refund = await createRefund(env, order.stripe_payment_intent_id);
        const refundAmount = typeof refund.amount === "number" && refund.currency
          ? fromStripeMinorAmount(refund.amount, refund.currency)
          : order.server_calculated_price;
        await markOrderPaymentStatus(env, order.id, "refunded", {
          source: "cron",
          refundAmount,
          refundStripeId: refund.id,
        });
        logEvent("stuck_order_refunded", { orderId: order.id });

        const invoice = await getInvoiceByOrderId(env, order.id);
        await sendRefundEmail(
          env,
          order,
          invoice?.invoice_number ?? null,
          "A levélgeneráló szolgáltatás egy technikai hiba miatt nem tudta időben feldolgozni a megrendelést.",
        );
      }
    } catch (err) {
      logEvent("stuck_order_resolve_failed", {
        orderId: order.id,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await app.fetch(request, env, ctx);
    return addSecurityHeaders(response);
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    const validation = validateEnv(env);
    if (!validation.ok) {
      logEnvValidationFailure(validation, "scheduled");
      return;
    }
    await cleanupExpiredData(env);
    const invoiceRetries = await retryDueInvoices(env);
    for (const retry of invoiceRetries) {
      logEvent("invoice_retry_finished", retry);
    }
    await resolveStuckOrders(env);
  },
};
