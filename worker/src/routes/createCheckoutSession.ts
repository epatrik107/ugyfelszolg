import type { Context } from "hono";
import { attachStripeSession, beginGeneration, getOrderById, insertOrder } from "../lib/db";
import { constantTimeEqual, generateOpaqueToken, hashToken } from "../lib/hash";
import { checkAiServiceAvailable } from "../lib/health";
import { logEvent } from "../lib/logger";
import { generateLetterForPaidOrder } from "../lib/openai";
import { getPackage } from "../lib/packages";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { noStoreJson } from "../lib/security";
import { createCheckoutSession } from "../lib/stripe";
import { verifyTurnstileToken } from "../lib/turnstile";
import type { Env } from "../lib/types";
import { checkoutSchema } from "../lib/validation";

function isDemoMode(env: Env) {
  return env.DEMO_MODE === "true";
}

function paymentsEnabled(env: Env) {
  return env.PAYMENTS_ENABLED === "true";
}

function isValidDemoAccess(env: Env, demoAccessCode: string) {
  return (
    isDemoMode(env) &&
    Boolean(env.DEMO_ACCESS_CODE) &&
    demoAccessCode.length > 0 &&
    constantTimeEqual(demoAccessCode, env.DEMO_ACCESS_CODE ?? "")
  );
}

export async function createCheckoutSessionRoute(c: Context<{ Bindings: Env }>) {
  const rawPayload = await c.req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return noStoreJson(c, { error: "Hibás űrlapadatok." }, 400);
  }

  const input = parsed.data;
  const ip = getClientIp(c);
  const demoAccessGranted = isValidDemoAccess(c.env, input.demoAccessCode);

  if (
    (await isRateLimited(c.env, "create-checkout-ip", ip)) ||
    (await isRateLimited(c.env, "create-checkout-email", input.email.toLowerCase()))
  ) {
    return noStoreJson(c, { error: "Túl sok próbálkozás. Kérjük, próbálja később." }, 429);
  }

  if (!demoAccessGranted && !paymentsEnabled(c.env)) {
    return noStoreJson(
      c,
      { error: "A demó jelenleg csak hozzáférési kóddal használható." },
      403,
    );
  }

  if (!demoAccessGranted && !input.turnstileToken) {
    return noStoreJson(c, { error: "Hiányzó spamvédelmi token." }, 400);
  }

  const turnstileOk =
    demoAccessGranted ||
    (await verifyTurnstileToken(c.env, input.turnstileToken, ip));
  if (!turnstileOk) {
    return noStoreJson(c, { error: "A spamvédelem ellenőrzése sikertelen." }, 400);
  }

  const selectedPackage = getPackage(input.selectedPackage);
  const orderId = crypto.randomUUID();
  const publicId = crypto.randomUUID();
  const resultToken = generateOpaqueToken();
  const resultTokenHash = await hashToken(resultToken, c.env.TOKEN_HASH_SECRET);

  if (demoAccessGranted) {
    await insertOrder(c.env, {
      id: orderId,
      publicId,
      resultTokenHash,
      resultToken,
      email: input.email.toLowerCase(),
      name: input.name,
      letterType: input.letterType,
      recipient: input.recipient,
      problemDescription: input.problemDescription,
      desiredResult: input.desiredResult,
      tone: input.tone,
      previousMessages: input.previousMessages,
      selectedPackage: input.selectedPackage,
      price: selectedPackage.price,
      currency: selectedPackage.currency,
      paymentStatus: "paid",
    });
    logEvent("order_created", { orderId, publicId, packageId: input.selectedPackage });
    logEvent("demo_order_created", { orderId, publicId, packageId: input.selectedPackage });
    const started = await beginGeneration(c.env, orderId);
    if (started) {
      const order = await getOrderById(c.env, orderId);
      if (order) {
        c.executionCtx.waitUntil(generateLetterForPaidOrder(c.env, order));
      }
    }

    return noStoreJson(c, {
      checkoutUrl: `${c.env.SITE_URL}/sikeres-fizetes?order=${publicId}&token=${resultToken}`,
      publicId,
      demo: true,
    });
  }

  // Check AI service availability before creating the order and payment session
  const aiAvailable = await checkAiServiceAvailable(c.env);
  if (!aiAvailable) {
    logEvent("checkout_blocked_ai_unavailable", {});
    return noStoreJson(
      c,
      { error: "A levélgeneráló szolgáltatás átmenetileg nem elérhető. Kérjük, próbálja újra néhány perc múlva." },
      503,
    );
  }

  await insertOrder(c.env, {
    id: orderId,
    publicId,
    resultTokenHash,
    resultToken,
    email: input.email.toLowerCase(),
    name: input.name,
    letterType: input.letterType,
    recipient: input.recipient,
    problemDescription: input.problemDescription,
    desiredResult: input.desiredResult,
    tone: input.tone,
    previousMessages: input.previousMessages,
    selectedPackage: input.selectedPackage,
    price: selectedPackage.price,
    currency: selectedPackage.currency,
    paymentStatus: "pending",
  });
  logEvent("order_created", { orderId, publicId, packageId: input.selectedPackage });

  const session = await createCheckoutSession(c.env, {
    packageId: input.selectedPackage,
    packageName: selectedPackage.name,
    amount: selectedPackage.price,
    currency: selectedPackage.currency,
    email: input.email,
    orderId,
    publicId,
    resultToken,
  });

  if (!session.url) {
    throw new Error("Stripe session URL missing.");
  }

  await attachStripeSession(c.env, orderId, session.id);
  logEvent("stripe_session_created", { orderId, stripeSessionId: session.id });

  return noStoreJson(c, {
    checkoutUrl: session.url,
    publicId,
  });
}
