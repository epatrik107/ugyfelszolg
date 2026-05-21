import type { Context } from "hono";
import {
  ensureUsagePeriod,
  getLatestActiveSubscriptionByEmail,
  getMagicLinkByHash,
  getSubscriptionByStripeId,
  getSubscriptionSessionByHash,
  hasAvailableQuota,
  insertMagicLink,
  insertOrder,
  insertSubscriptionSession,
  reserveQuota,
  touchSubscriptionSession,
  consumeMagicLink,
} from "../lib/db";
import { sendBusinessMagicLink } from "../lib/email";
import { generateOpaqueToken, hashToken } from "../lib/hash";
import { getPackage } from "../lib/packages";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { noStoreJson } from "../lib/security";
import { createCustomerPortalSession } from "../lib/stripe";
import { verifyTurnstileToken } from "../lib/turnstile";
import type { Env, SubscriptionRow } from "../lib/types";
import {
  accessLinkSchema,
  businessOrderSchema,
  exchangeMagicLinkSchema,
} from "../lib/validation";
import { beginGeneration, getOrderById } from "../lib/db";
import { generateLetterForPaidOrder } from "../lib/openai";

const MAGIC_LINK_EXPIRY_MS = 30 * 60 * 1000;

async function getSessionFromAuthHeader(c: Context<{ Bindings: Env }>) {
  const header = c.req.header("Authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
  if (!token) {
    return null;
  }
  const tokenHash = await hashToken(token, c.env.TOKEN_HASH_SECRET);
  const session = await getSubscriptionSessionByHash(c.env, tokenHash);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    return null;
  }
  await touchSubscriptionSession(c.env, session.id);
  return session;
}

export async function sendBusinessAccessLinkRoute(c: Context<{ Bindings: Env }>) {
  const parsed = accessLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(c, { error: "Hibás kérés." }, 400);
  }

  const ip = getClientIp(c);
  if (await isRateLimited(c.env, "business-access-ip", ip)) {
    return noStoreJson(c, { ok: true });
  }

  const turnstileOk = await verifyTurnstileToken(
    c.env,
    parsed.data.turnstileToken,
    ip,
  );
  if (!turnstileOk) {
    return noStoreJson(c, { error: "A spamvédelem ellenőrzése sikertelen." }, 400);
  }

  const subscription = await getLatestActiveSubscriptionByEmail(
    c.env,
    parsed.data.email.toLowerCase(),
  );

  if (subscription) {
    const token = generateOpaqueToken();
    await insertMagicLink(c.env, {
      id: crypto.randomUUID(),
      subscriptionId: subscription.id,
      tokenHash: await hashToken(token, c.env.TOKEN_HASH_SECRET),
      expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRY_MS).toISOString(),
    });
    await sendBusinessMagicLink(c.env, subscription, token);
  }

  return noStoreJson(c, { ok: true });
}

export async function exchangeBusinessMagicLinkRoute(c: Context<{ Bindings: Env }>) {
  const parsed = exchangeMagicLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(c, { error: "Hibás token." }, 400);
  }

  const ip = getClientIp(c);
  if (await isRateLimited(c.env, "business-magic-ip", ip)) {
    return noStoreJson(c, { error: "Túl sok próbálkozás." }, 429);
  }

  const tokenHash = await hashToken(parsed.data.token, c.env.TOKEN_HASH_SECRET);
  const magicLink = await getMagicLinkByHash(c.env, tokenHash);
  if (
    !magicLink ||
    magicLink.consumed_at ||
    new Date(magicLink.expires_at).getTime() <= Date.now()
  ) {
    return noStoreJson(c, { error: "A link érvénytelen vagy lejárt." }, 401);
  }

  if (!(await consumeMagicLink(c.env, magicLink.id))) {
    return noStoreJson(c, { error: "A link már felhasználásra került." }, 401);
  }

  const sessionToken = generateOpaqueToken();
  await insertSubscriptionSession(c.env, {
    id: crypto.randomUUID(),
    subscriptionId: magicLink.subscription_id,
    tokenHash: await hashToken(sessionToken, c.env.TOKEN_HASH_SECRET),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  return noStoreJson(c, { sessionToken });
}

export async function getBusinessSessionRoute(c: Context<{ Bindings: Env }>) {
  const session = await getSessionFromAuthHeader(c);
  if (!session) {
    return noStoreJson(c, { error: "Nincs érvényes céges munkamenet." }, 401);
  }

  const subscription = await getSubscriptionByStripeId(
    c.env,
    (await c.env.DB.prepare("SELECT stripe_subscription_id FROM subscriptions WHERE id = ?")
      .bind(session.subscription_id)
      .first<{ stripe_subscription_id: string }>())?.stripe_subscription_id ?? "",
  );
  if (!subscription) {
    return noStoreJson(c, { error: "Az előfizetés nem található." }, 404);
  }

  const usage = await ensureUsagePeriod(c.env, subscription);
  return noStoreJson(c, {
    email: session.email,
    status: session.status,
    quota: usage.quota,
    used: usage.used_count,
    reserved: usage.reserved_count,
    remaining: Math.max(usage.quota - usage.used_count - usage.reserved_count, 0),
    periodStart: usage.period_start,
    periodEnd: usage.period_end,
  });
}

export async function createBusinessOrderRoute(c: Context<{ Bindings: Env }>) {
  const session = await getSessionFromAuthHeader(c);
  if (!session || !["active", "trialing"].includes(session.status)) {
    return noStoreJson(c, { error: "Nincs aktív céges előfizetés." }, 401);
  }

  const parsed = businessOrderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(c, { error: "Hibás űrlapadatok." }, 400);
  }

  const subscription = (await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE id = ?",
  )
    .bind(session.subscription_id)
    .first<SubscriptionRow>())!;
  const usage = await ensureUsagePeriod(c.env, subscription);
  if (!hasAvailableQuota(usage) || !(await reserveQuota(c.env, usage))) {
    return noStoreJson(c, { error: "A havi levélkeret elfogyott." }, 409);
  }

  const resultToken = generateOpaqueToken();
  const orderId = crypto.randomUUID();
  const publicId = crypto.randomUUID();
  const businessPackage = getPackage("business");
  await insertOrder(c.env, {
    id: orderId,
    publicId,
    resultTokenHash: await hashToken(resultToken, c.env.TOKEN_HASH_SECRET),
    email: parsed.data.email.toLowerCase(),
    name: parsed.data.name,
    letterType: parsed.data.letterType,
    recipient: parsed.data.recipient,
    problemDescription: parsed.data.problemDescription,
    desiredResult: parsed.data.desiredResult,
    tone: parsed.data.tone,
    previousMessages: parsed.data.previousMessages,
    attachedLetter: parsed.data.attachedLetter || null,
    selectedPackage: "business",
    price: businessPackage.price,
    currency: businessPackage.currency,
    billingSource: "subscription",
    subscriptionId: subscription.id,
    paymentStatus: "paid",
  });

  const started = await beginGeneration(c.env, orderId);
  if (started) {
    const order = await getOrderById(c.env, orderId);
    if (order) {
      c.executionCtx.waitUntil(generateLetterForPaidOrder(c.env, order));
    }
  }

  return noStoreJson(c, { publicId, resultToken });
}

export async function createBusinessPortalSessionRoute(c: Context<{ Bindings: Env }>) {
  const session = await getSessionFromAuthHeader(c);
  if (!session) {
    return noStoreJson(c, { error: "Nincs érvényes munkamenet." }, 401);
  }

  const subscription = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE id = ?",
  )
    .bind(session.subscription_id)
    .first<SubscriptionRow>();
  if (!subscription) {
    return noStoreJson(c, { error: "Az előfizetés nem található." }, 404);
  }

  const portal = await createCustomerPortalSession(
    c.env,
    subscription.stripe_customer_id,
  );
  return noStoreJson(c, { url: portal.url });
}
