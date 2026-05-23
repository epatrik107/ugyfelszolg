import type { Context } from "hono";
import { beginRegeneration, getOrderByPublicId } from "../lib/db";
import { constantTimeEqual, hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { generateLetterForPaidOrder } from "../lib/ai";
import { canRequestRegeneration, MAX_REGENERATIONS } from "../lib/orderState";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import type { Env } from "../lib/types";
import { regenerationSchema } from "../lib/validation";

export async function regenerateOrderRoute(c: Context<{ Bindings: Env }>) {
  const publicId = c.req.param("publicId") ?? "";
  const authHeader = c.req.header("Authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
  const ip = getClientIp(c);

  if (await isRateLimited(c.env, "regenerate-ip", ip)) {
    return errorJson(c, "RATE_LIMITED", "Túl sok kérés. Kérjük, várjon egy percet.", 429);
  }

  if (!bearerToken) {
    return errorJson(c, "UNAUTHORIZED", "Hiányzó azonosító.", 401);
  }

  let feedback = "";
  try {
    const body = await c.req.json();
    const parsed = regenerationSchema.safeParse(body);
    if (!parsed.success) {
      return errorJson(c, "INVALID_INPUT", "Kérlek, írd le röviden, mit szeretnél megváltoztatni.", 400);
    }
    feedback = parsed.data.feedback;
  } catch {
    return errorJson(c, "INVALID_INPUT", "Kérlek, írd le röviden, mit szeretnél megváltoztatni.", 400);
  }

  const order = await getOrderByPublicId(c.env, publicId);
  if (!order) {
    return errorJson(c, "NOT_FOUND", "A rendelés nem található.", 404);
  }

  const tokenHash = await hashToken(bearerToken, c.env.TOKEN_HASH_SECRET);
  if (!constantTimeEqual(order.result_token_hash, tokenHash)) {
    return errorJson(c, "UNAUTHORIZED", "Érvénytelen azonosító.", 401);
  }

  if (!canRequestRegeneration(order)) {
    return errorJson(
      c,
      "CONFLICT",
      "A módosítás jelenleg nem lehetséges. Ellenőrizze, hogy van-e még felhasználható módosítási lehetősége, és hogy az előző levél már elkészült.",
      409,
    );
  }

  const started = await beginRegeneration(c.env, order.id, MAX_REGENERATIONS);
  if (!started) {
    return errorJson(c, "CONFLICT", "A módosítás elindítása nem sikerült. Kérjük, próbálja újra.", 409);
  }

  // Fetch the fresh order (generation_count is now incremented) for the generation function
  const freshOrder = await getOrderByPublicId(c.env, publicId);
  if (!freshOrder) {
    return errorJson(c, "INTERNAL_ERROR", "Váratlan hiba. Kérjük, vegye fel velünk a kapcsolatot.", 500);
  }

  logEvent("regeneration_started", { orderId: order.id, generationCount: freshOrder.generation_count });
  c.executionCtx.waitUntil(generateLetterForPaidOrder(c.env, freshOrder, feedback));

  return okJson(c, {});
}
