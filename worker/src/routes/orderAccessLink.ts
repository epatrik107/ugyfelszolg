import type { Context } from "hono";
import { hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { enqueueEmail } from "../lib/outbox";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import { verifyTurnstileToken } from "../lib/turnstile";
import type { Env } from "../lib/types";
import { orderAccessLinkSchema } from "../lib/validation";

const GENERIC_MESSAGE = "Ha ehhez az email-címhez tartozik elérhető rendelés, néhány percen belül elküldjük a linkjeit.";

/**
 * Self-service recovery for customers who lost the result link. The response
 * never reveals whether an order exists, and links only go to the order's own
 * email address.
 */
export async function orderAccessLinkRoute(c: Context<{ Bindings: Env }>) {
  const parsed = orderAccessLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorJson(c, "INVALID_INPUT", "Adjon meg egy érvényes email-címet.", 400);
  }
  const email = parsed.data.email.toLowerCase();
  const ip = getClientIp(c);
  if (await isRateLimited(c.env, "access-link-ip", ip)) {
    return errorJson(c, "RATE_LIMITED", "Túl sok kérés. Kérjük, próbálja újra később.", 429);
  }
  if (!(await verifyTurnstileToken(c.env, parsed.data.turnstileToken, ip, "access_link"))) {
    return errorJson(c, "TURNSTILE_FAILED", "A spamvédelem ellenőrzése sikertelen.", 400);
  }
  // Counted only after the challenge, so nobody can exhaust another customer's quota.
  if (await isRateLimited(c.env, "access-link-email", email)) {
    return errorJson(c, "RATE_LIMITED", "Túl sok kérés. Kérjük, próbálja újra később.", 429);
  }

  const orders = await c.env.DB.prepare(
    `SELECT id FROM orders
     WHERE email = ?
       AND payment_status IN ('paid', 'partially_refunded', 'chargeback_won')
       AND checkout_idempotency_key IS NOT NULL
       AND personal_data_redacted_at IS NULL
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 10`,
  ).bind(email, new Date(Date.now() - 90 * 86400000).toISOString()).all<{ id: string }>();

  if (orders.results.length > 0) {
    const bucket = Math.floor(Date.now() / 3600_000);
    const emailKey = (await hashToken(`access-link:${email}`, c.env.TOKEN_HASH_SECRET)).slice(0, 32);
    await enqueueEmail(c.env, {
      kind: "access_links",
      dedupeKey: `access-links:${emailKey}:${bucket}`,
      payload: { orderIds: orders.results.map((order) => order.id) },
    });
  }
  logEvent("order_access_link_requested", { matched: orders.results.length > 0 });
  return okJson(c, { message: GENERIC_MESSAGE });
}
