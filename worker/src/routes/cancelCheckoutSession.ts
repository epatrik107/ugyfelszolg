import type { Context } from "hono";
import { getOrderByPublicId, markOrderPaymentStatus } from "../lib/db";
import { constantTimeEqual, hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import { expireCheckoutSession, retrieveCheckoutSession } from "../lib/stripe";
import type { Env } from "../lib/types";

export async function cancelCheckoutSessionRoute(c: Context<{ Bindings: Env }>) {
  const publicId = c.req.param("publicId") ?? "";
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7)
    : "";
  if (!token) return errorJson(c, "UNAUTHORIZED", "Hiányzó token.", 401);
  if (await isRateLimited(c.env, "cancel-checkout-ip", getClientIp(c))) {
    return errorJson(c, "RATE_LIMITED", "Túl sok próbálkozás.", 429);
  }

  const order = await getOrderByPublicId(c.env, publicId);
  if (!order) return errorJson(c, "NOT_FOUND", "A rendelés nem található.", 404);
  const tokenHash = await hashToken(token, c.env.TOKEN_HASH_SECRET);
  if (!constantTimeEqual(tokenHash, order.result_token_hash)) {
    return errorJson(c, "UNAUTHORIZED", "Érvénytelen token.", 401);
  }
  if (order.payment_status === "paid" || order.payment_status === "partially_refunded" || order.payment_status === "refunded") {
    return errorJson(c, "ORDER_ALREADY_PAID", "A fizetés már megtörtént.", 409);
  }
  if (order.payment_status === "cancelled" || order.payment_status === "expired") {
    return okJson(c, { paymentStatus: order.payment_status });
  }

  if (order.stripe_session_id) {
    const session = await retrieveCheckoutSession(c.env, order.stripe_session_id);
    if (session.payment_status === "paid" || session.status === "complete") {
      return errorJson(c, "ORDER_ALREADY_PAID", "A fizetés már véglegesítés alatt áll.", 409);
    }
    if (session.status === "open") {
      await expireCheckoutSession(c.env, session.id);
    }
  }

  await markOrderPaymentStatus(c.env, order.id, "cancelled", { source: "user" });
  logEvent("checkout_cancelled", { orderId: order.id });
  return okJson(c, { paymentStatus: "cancelled" });
}
