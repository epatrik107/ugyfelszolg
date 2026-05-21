import type { Context } from "hono";
import { getOrderByPublicId } from "../lib/db";
import { constantTimeEqual, hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { noStoreJson } from "../lib/security";
import type { Env } from "../lib/types";

export async function getOrderResultRoute(c: Context<{ Bindings: Env }>) {
  const publicId = c.req.param("publicId") ?? "";
  const authHeader = c.req.header("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const token = bearerToken || c.req.query("token") || "";
  const ip = getClientIp(c);

  if (await isRateLimited(c.env, "result-ip", ip)) {
    return noStoreJson(c, { error: "Túl sok lekérdezés." }, 429);
  }

  if (!token) {
    return noStoreJson(c, { error: "Hiányzó token." }, 401);
  }

  const order = await getOrderByPublicId(c.env, publicId);
  if (!order) {
    return noStoreJson(c, { error: "A rendelés nem található." }, 404);
  }

  const tokenHash = await hashToken(token, c.env.TOKEN_HASH_SECRET);
  if (!constantTimeEqual(order.result_token_hash, tokenHash)) {
    return noStoreJson(c, { error: "Érvénytelen token." }, 401);
  }

  logEvent("result_fetch", { orderId: order.id, publicId });

  return noStoreJson(c, {
    paymentStatus: order.payment_status,
    aiStatus: order.ai_status,
    generatedLetter:
      order.ai_status === "completed" ? order.generated_letter : undefined,
    selectedPackage: order.selected_package,
    createdAt: order.created_at,
  });
}
