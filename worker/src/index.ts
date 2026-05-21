import { Hono } from "hono";
import { addSecurityHeaders, bodySizeGuard, corsGuard, noStoreJson } from "./lib/security";
import { cleanupExpiredData } from "./lib/db";
import { logEvent } from "./lib/logger";
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
import { stripeWebhookRoute } from "./routes/stripeWebhook";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsGuard);
app.use("/api/*", bodySizeGuard);
app.post("/api/create-checkout-session", createCheckoutSessionRoute);
app.post("/api/stripe/webhook", stripeWebhookRoute);
app.get("/api/orders/:publicId/result", getOrderResultRoute);
app.post("/api/contact", contactRoute);
app.post("/api/business/access-link", sendBusinessAccessLinkRoute);
app.post("/api/business/session/exchange", exchangeBusinessMagicLinkRoute);
app.get("/api/business/session", getBusinessSessionRoute);
app.post("/api/business/orders", createBusinessOrderRoute);
app.post("/api/business/customer-portal-session", createBusinessPortalSessionRoute);
app.notFound((c) => c.json({ error: "Nem található." }, 404));
app.onError((error, c) => {
  logEvent("unhandled_error", {
    path: new URL(c.req.url).pathname,
    message: error instanceof Error ? error.message : "unknown",
  });
  return noStoreJson(c, { error: "Váratlan szerverhiba." }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await app.fetch(request, env, ctx);
    return addSecurityHeaders(response);
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await cleanupExpiredData(env);
  },
};
