import type { Context } from "hono";
import {
  getLetterEmailVersionKey,
  getOrderByPublicId,
  hasLetterEmailVersionSent,
  markLetterEmailSent,
} from "../lib/db";
import { sendLetterReadyEmail } from "../lib/email";
import { constantTimeEqual, hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { hasActiveOrderAccess } from "../lib/orderState";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import type { Env } from "../lib/types";
import { sendLetterSchema } from "../lib/validation";

export async function sendLetterRoute(c: Context<{ Bindings: Env }>) {
  const publicId = c.req.param("publicId") ?? "";
  const authHeader = c.req.header("Authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
  const ip = getClientIp(c);

  if (await isRateLimited(c.env, "send-letter-ip", ip)) {
    return errorJson(c, "RATE_LIMITED", "Túl sok kérés. Kérjük, várjon egy percet.", 429);
  }

  if (!bearerToken) {
    return errorJson(c, "UNAUTHORIZED", "Hiányzó azonosító.", 401);
  }

  const order = await getOrderByPublicId(c.env, publicId);
  if (!order) {
    return errorJson(c, "NOT_FOUND", "A rendelés nem található.", 404);
  }

  const tokenHash = await hashToken(bearerToken, c.env.TOKEN_HASH_SECRET);
  if (!constantTimeEqual(order.result_token_hash, tokenHash)) {
    return errorJson(c, "UNAUTHORIZED", "Érvénytelen azonosító.", 401);
  }

  if (!hasActiveOrderAccess(order)) {
    return errorJson(c, "ACCESS_REVOKED", "A rendeléshez tartozó hozzáférés nem aktív.", 409);
  }

  if (order.ai_status !== "completed" || !order.generated_letter) {
    return errorJson(c, "GENERATION_PENDING", "A levél még nem áll rendelkezésre.", 409);
  }

  // Determine which version to send (optional versionIndex = history index)
  let letterToSend = order.generated_letter;

  const rawBody = await c.req.json().catch(() => ({}));
  const parsedBody = sendLetterSchema.safeParse(rawBody ?? {});
  if (!parsedBody.success) {
    return errorJson(c, "INVALID_INPUT", "Hibás emailküldési kérés.", 400);
  }
  const body = parsedBody.data;

  if (body.versionIndex !== undefined) {
    if (!order.letter_history) {
      return errorJson(c, "NOT_FOUND", "Nincs korábbi változat.", 404);
    }
    let history: string[];
    try {
      history = JSON.parse(order.letter_history) as string[];
    } catch {
      return errorJson(c, "INTERNAL_ERROR", "Hibás változat-adat.", 500);
    }
    const version = history[body.versionIndex];
    if (!version) {
      return errorJson(c, "NOT_FOUND", "A kért változat nem található.", 404);
    }
    letterToSend = version;
  }

  const versionKey = await getLetterEmailVersionKey(letterToSend);
  if (hasLetterEmailVersionSent(order, versionKey)) {
    return okJson(c, { alreadySent: true });
  }

  try {
    const idempotencyKeySuffix = `v-${versionKey.slice(-16)}`;
    const emailResult = await sendLetterReadyEmail(c.env, order, letterToSend, bearerToken, idempotencyKeySuffix);
    await markLetterEmailSent(c.env, order.id, versionKey);
    logEvent("letter_email_sent_manual", {
      orderId: order.id,
      generationCount: order.generation_count,
      versionIndex: body.versionIndex ?? "current",
      delivered: Boolean(emailResult.providerMessageId),
    });
  } catch (err) {
    logEvent("letter_email_send_failed", {
      orderId: order.id,
      errorType: err instanceof Error ? err.name : "unknown",
    });
    return errorJson(c, "INTERNAL_ERROR", "Az email küldése nem sikerült. Kérjük, próbálja újra.", 500);
  }

  return okJson(c, {});
}
