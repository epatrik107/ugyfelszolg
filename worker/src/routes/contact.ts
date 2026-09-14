import type { Context } from "hono";
import { insertContactMessageStatement } from "../lib/db";
import { enqueueEmailStatement } from "../lib/outbox";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import { verifyTurnstileToken } from "../lib/turnstile";
import type { Env } from "../lib/types";
import { contactSchema } from "../lib/validation";

export async function contactRoute(c: Context<{ Bindings: Env }>) {
  const rawPayload = await c.req.json().catch(() => null);
  const parsed = contactSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return errorJson(c, "INVALID_INPUT", "Hibás üzenetadatok.", 400);
  }

  const input = parsed.data;
  const ip = getClientIp(c);
  if (
    (await isRateLimited(c.env, "contact-ip", ip)) ||
    (await isRateLimited(c.env, "contact-email", input.email.toLowerCase()))
  ) {
    return errorJson(c, "RATE_LIMITED", "Túl sok üzenet. Kérjük, próbálja később.", 429);
  }

  const turnstileOk = await verifyTurnstileToken(
    c.env,
    input.turnstileToken,
    ip,
    "contact",
  );
  if (!turnstileOk) {
    return errorJson(c, "TURNSTILE_FAILED", "A spamvédelem ellenőrzése sikertelen.", 400);
  }

  const message = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email.toLowerCase(),
    message: input.message,
    createdAt: new Date().toISOString(),
  };
  // Stored and queued atomically so a support request can never be silently unread.
  await c.env.DB.batch([
    insertContactMessageStatement(c.env, message),
    enqueueEmailStatement(c.env, {
      kind: "contact_notification",
      dedupeKey: `contact:${message.id}`,
      payload: { name: message.name, email: message.email, message: message.message, receivedAt: message.createdAt },
    }),
  ]);

  return okJson(c, {});
}
