import type { Context } from "hono";
import { getOrderByPublicId } from "../lib/db";
import { constantTimeEqual, hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { hasActiveOrderAccess } from "../lib/orderState";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import type { Env } from "../lib/types";

export async function getOrderResultRoute(c: Context<{ Bindings: Env }>) {
  const publicId = c.req.param("publicId") ?? "";
  const authHeader = c.req.header("Authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
  const token = bearerToken || c.req.query("token") || "";
  const ip = getClientIp(c);

  if (await isRateLimited(c.env, "result-ip", ip)) {
    return errorJson(c, "RATE_LIMITED", "Túl sok lekérdezés.", 429);
  }

  if (!token) {
    return errorJson(c, "UNAUTHORIZED", "Hiányzó token.", 401);
  }

  const order = await getOrderByPublicId(c.env, publicId);
  if (!order) {
    return errorJson(c, "NOT_FOUND", "A rendelés nem található.", 404);
  }

  const tokenHash = await hashToken(token, c.env.TOKEN_HASH_SECRET);
  if (!constantTimeEqual(order.result_token_hash, tokenHash)) {
    return errorJson(c, "UNAUTHORIZED", "Érvénytelen token.", 401);
  }

  logEvent("result_fetch", { orderId: order.id, publicId });
  const canExposeLetter = hasActiveOrderAccess(order) && order.ai_status === "completed";

  return okJson(c, {
    paymentStatus: order.payment_status,
    refundStatus: order.stripe_refund_status,
    invoiceStatus: order.invoice_status,
    aiStatus: order.ai_status,
    generationCount: order.generation_count,
    generatedLetter: canExposeLetter ? order.generated_letter : undefined,
    letterHistory: (() => {
      if (!canExposeLetter) return [];
      if (!order.letter_history) return [];
      try {
        return JSON.parse(order.letter_history) as string[];
      } catch {
        logEvent("letter_history_parse_error", { orderId: order.id });
        return [];
      }
    })(),
    letterEmailSent: order.letter_email_sent === 1,
    selectedPackage: order.selected_package,
    createdAt: order.created_at,
  });
}
