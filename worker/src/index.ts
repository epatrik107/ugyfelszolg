import { Hono } from "hono";
import { addSecurityHeaders, bodySizeGuard, corsGuard, noStoreJson, requireJsonContentType } from "./lib/security";
import { cleanupExpiredData, getStuckGeneratingOrders, markOrderPaymentStatus } from "./lib/db";
import { sendRefundEmail } from "./lib/email";
import { getInvoiceByOrderId } from "./lib/invoice";
import { logEvent } from "./lib/logger";
import { createRefund } from "./lib/stripe";
import type { Env } from "./lib/types";
import {
  createBusinessOrderRoute,
  createBusinessPortalSessionRoute,
  exchangeBusinessMagicLinkRoute,
  getBusinessSessionRoute,
  sendBusinessAccessLinkRoute,
} from "./routes/business";
import { contactRoute } from "./routes/contact";
import { createCheckoutSessionRoute } from "./routes/createCheckoutSession";
import { getOrderResultRoute } from "./routes/getOrderResult";
import { regenerateOrderRoute } from "./routes/regenerateOrder";
import { sendLetterRoute } from "./routes/sendLetter";
import { stripeWebhookRoute } from "./routes/stripeWebhook";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsGuard);
app.use("/api/*", bodySizeGuard);
app.use("/api/*", requireJsonContentType);
app.post("/api/create-checkout-session", createCheckoutSessionRoute);
app.post("/api/stripe/webhook", stripeWebhookRoute);
app.get("/api/orders/:publicId/result", getOrderResultRoute);
app.post("/api/orders/:publicId/regenerate", regenerateOrderRoute);
app.post("/api/orders/:publicId/send-letter", sendLetterRoute);
app.post("/api/contact", contactRoute);
app.post("/api/business/access-link", sendBusinessAccessLinkRoute);
app.post("/api/business/session/exchange", exchangeBusinessMagicLinkRoute);
app.get("/api/business/session", getBusinessSessionRoute);
app.post("/api/business/orders", createBusinessOrderRoute);
app.post("/api/business/customer-portal-session", createBusinessPortalSessionRoute);
app.get("/api/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").run();
    return c.json({ status: "ok", ts: new Date().toISOString() });
  } catch {
    return c.json({ status: "degraded" }, 503);
  }
});
app.notFound((c) => c.json({ error: "Nem található." }, 404));
app.onError((error, c) => {
  logEvent("unhandled_error", {
    path: new URL(c.req.url).pathname,
    message: error instanceof Error ? error.message : "unknown",
  });
  return noStoreJson(c, { error: "Váratlan szerverhiba." }, 500);
});

async function resolveStuckOrders(env: Env) {
  const stuckOrders = await getStuckGeneratingOrders(env);
  if (stuckOrders.length === 0) return;

  logEvent("cron_stuck_orders_found", { count: stuckOrders.length });

  for (const order of stuckOrders) {
    try {
      await env.DB.prepare(
        "UPDATE orders SET ai_status = 'failed', ai_error = ?, updated_at = ? WHERE id = ?",
      )
        .bind("Automatikusan lezárva: generálás időtúllépés.", new Date().toISOString(), order.id)
        .run();

      logEvent("stuck_order_resolved", { orderId: order.id });

      if (order.stripe_payment_intent_id && order.billing_source === "checkout") {
        await createRefund(env, order.stripe_payment_intent_id);
        await markOrderPaymentStatus(env, order.id, "refunded");
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
    await cleanupExpiredData(env);
    await resolveStuckOrders(env);
  },
};
