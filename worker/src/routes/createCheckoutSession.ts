import type { Context } from "hono";
import {
  attachStripeSession,
  beginGeneration,
  getOrderByCheckoutIdempotencyKey,
  getOrderById,
  insertOrder,
} from "../lib/db";
import {
  assertBillingDetails,
  calculateOrderPrice,
  detectSuspiciousCheckoutInput,
  looksLikeBusinessName,
} from "../lib/billing";
import { constantTimeEqual, hashToken } from "../lib/hash";
import { checkAiServiceAvailable } from "../lib/health";
import { logEvent } from "../lib/logger";
import { generateLetterForPaidOrder } from "../lib/ai";
import { getPackage } from "../lib/packages";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import { createCheckoutSession, retrieveCheckoutSession } from "../lib/stripe";
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
    !paymentsEnabled(env) &&
    Boolean(env.DEMO_ACCESS_CODE) &&
    demoAccessCode.length > 0 &&
    constantTimeEqual(demoAccessCode, env.DEMO_ACCESS_CODE ?? "")
  );
}

export async function createCheckoutSessionRoute(c: Context<{ Bindings: Env }>) {
  const rawPayload = await c.req.json().catch(() => null);
  const suspiciousInput = detectSuspiciousCheckoutInput(rawPayload);
  if (suspiciousInput) {
    const event = suspiciousInput === "tax_data"
      ? "rejected_tax_number_attempt"
      : suspiciousInput === "manipulated_price"
        ? "rejected_manipulated_price"
        : "rejected_business_buyer_attempt";
    logEvent(event, { reason: suspiciousInput });
    return errorJson(
      c,
      suspiciousInput === "manipulated_price" ? "INVALID_INPUT" : "INVALID_BILLING_DATA",
      suspiciousInput === "manipulated_price"
        ? "Az ár kizárólag szerveroldalon határozható meg."
        : "Érvénytelen vagy nem támogatott számlázási adat.",
      400,
    );
  }
  const parsed = checkoutSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const billingName =
      rawPayload && typeof rawPayload === "object"
        ? (rawPayload as { billing?: { name?: unknown } }).billing?.name
        : undefined;
    if (typeof billingName === "string" && looksLikeBusinessName(billingName)) {
      logEvent("rejected_business_buyer_attempt", { reason: "business_name" });
      return errorJson(
        c,
        "INVALID_BILLING_DATA",
        "Céges számlázáshoz válassza a céges vásárló típust és adja meg az adószámot.",
        400,
      );
    }
    return errorJson(c, "INVALID_INPUT", "Hibás űrlapadatok.", 400);
  }

  const input = parsed.data;
  try {
    assertBillingDetails(input.billing);
  } catch (error) {
    const message = error instanceof Error && error.message === "INVALID_BUSINESS_TAX_NUMBER"
      ? "Érvényes magyar adószám szükséges a céges számlázáshoz."
      : "Érvénytelen számlázási adat.";
    return errorJson(c, "INVALID_BILLING_DATA", message, 400);
  }
  const ip = getClientIp(c);
  const demoAccessGranted = isValidDemoAccess(c.env, input.demoAccessCode);
  const price = calculateOrderPrice(input.selectedPackage);
  const inputFingerprint = await hashToken(
    JSON.stringify({
      name: input.name,
      email: input.email.toLowerCase(),
      letterType: input.letterType,
      recipient: input.recipient,
      problemDescription: input.problemDescription,
      desiredResult: input.desiredResult,
      tone: input.tone,
      previousMessages: input.previousMessages,
      selectedPackage: input.selectedPackage,
      billing: input.billing,
    }),
    c.env.TOKEN_HASH_SECRET,
  );

  if (
    (await isRateLimited(c.env, "create-checkout-ip", ip)) ||
    (await isRateLimited(c.env, "create-checkout-email", input.email.toLowerCase()))
  ) {
    return errorJson(c, "RATE_LIMITED", "Túl sok próbálkozás. Kérjük, próbálja később.", 429);
  }

  if (!demoAccessGranted && !paymentsEnabled(c.env)) {
    return errorJson(c, "DEMO_ONLY", "A demó jelenleg csak hozzáférési kóddal használható.", 403);
  }

  const existingOrder = await getOrderByCheckoutIdempotencyKey(
    c.env,
    input.checkoutAttemptId,
  );
  if (existingOrder) {
    if (existingOrder.checkout_input_hash !== inputFingerprint) {
      logEvent("checkout_idempotency_conflict", { orderId: existingOrder.id });
      return errorJson(
        c,
        "IDEMPOTENCY_CONFLICT",
        "Ez a fizetési kísérlet más rendelési adatokhoz tartozik.",
        409,
      );
    }
    if (demoAccessGranted && existingOrder.payment_status === "paid") {
      const existingToken = await hashToken(
        `checkout-result:${input.checkoutAttemptId}`,
        c.env.TOKEN_HASH_SECRET,
      );
      return okJson(c, {
        checkoutUrl: `${c.env.SITE_URL}/sikeres-fizetes?order=${existingOrder.public_id}&token=${existingToken}`,
        publicId: existingOrder.public_id,
        demo: true,
      });
    }
    if (existingOrder.payment_status === "paid") {
      return errorJson(c, "ORDER_ALREADY_PAID", "Ez a rendelés már ki lett fizetve.", 409);
    }
    if (existingOrder.stripe_session_id) {
      const existingSession = await retrieveCheckoutSession(
        c.env,
        existingOrder.stripe_session_id,
      );
      if (existingSession.status === "open" && existingSession.url) {
        logEvent("checkout_session_reused", { orderId: existingOrder.id });
        return okJson(c, {
          checkoutUrl: existingSession.url,
          publicId: existingOrder.public_id,
        });
      }
      return errorJson(
        c,
        "CHECKOUT_NOT_PAYABLE",
        "Ez a fizetési munkamenet már nem használható.",
        409,
      );
    }
  }

  if (!demoAccessGranted && !input.turnstileToken) {
    return errorJson(c, "INVALID_INPUT", "Hiányzó spamvédelmi token.", 400);
  }

  const turnstileOk =
    demoAccessGranted ||
    (await verifyTurnstileToken(c.env, input.turnstileToken, ip));
  if (!turnstileOk) {
    return errorJson(c, "TURNSTILE_FAILED", "A spamvédelem ellenőrzése sikertelen.", 400);
  }

  const selectedPackage = getPackage(input.selectedPackage);
  let orderId: string = crypto.randomUUID();
  let publicId: string = crypto.randomUUID();
  // Deterministic per checkout attempt so concurrent retries cannot create a
  // Stripe session whose success token differs from the hash stored in D1.
  const resultToken = await hashToken(
    `checkout-result:${input.checkoutAttemptId}`,
    c.env.TOKEN_HASH_SECRET,
  );
  const resultTokenHash = await hashToken(resultToken, c.env.TOKEN_HASH_SECRET);

  if (demoAccessGranted) {
    const inserted = await insertOrder(c.env, {
      id: orderId,
      publicId,
      resultTokenHash,
      email: input.email.toLowerCase(),
      name: input.name,
      letterType: input.letterType,
      recipient: input.recipient,
      problemDescription: input.problemDescription,
      desiredResult: input.desiredResult,
      tone: input.tone,
      previousMessages: input.previousMessages,
      selectedPackage: input.selectedPackage,
      price: price.payableAmount,
      currency: price.currency,
      paymentStatus: "paid",
      checkoutIdempotencyKey: input.checkoutAttemptId,
      checkoutInputHash: inputFingerprint,
      billing: input.billing,
    });
    if (!inserted) {
      const racedOrder = await getOrderByCheckoutIdempotencyKey(
        c.env,
        input.checkoutAttemptId,
      );
      if (!racedOrder || racedOrder.checkout_input_hash !== inputFingerprint) {
        return errorJson(c, "IDEMPOTENCY_CONFLICT", "Ütköző fizetési kísérlet.", 409);
      }
      return okJson(c, {
        checkoutUrl: `${c.env.SITE_URL}/sikeres-fizetes?order=${racedOrder.public_id}&token=${resultToken}`,
        publicId: racedOrder.public_id,
        demo: true,
      });
    }
    logEvent("order_created", { orderId, publicId, packageId: input.selectedPackage });
    logEvent("demo_order_created", { orderId, publicId, packageId: input.selectedPackage });
    const started = await beginGeneration(c.env, orderId);
    if (started) {
      const order = await getOrderById(c.env, orderId);
      if (order) {
        c.executionCtx.waitUntil(generateLetterForPaidOrder(c.env, order));
      }
    }

    return okJson(c, {
      checkoutUrl: `${c.env.SITE_URL}/sikeres-fizetes?order=${publicId}&token=${resultToken}`,
      publicId,
      demo: true,
    });
  }

  // Prevent charging when the configured AI models are unavailable. Demo
  // requests skip this preflight and surface generation failures directly.
  const aiAvailable = await checkAiServiceAvailable(
    c.env,
    selectedPackage.capabilities.isPremiumModel,
  );
  if (!aiAvailable) {
    logEvent("checkout_blocked_ai_unavailable", {});
    return errorJson(
      c,
      "SERVICE_UNAVAILABLE",
      "A levélgeneráló szolgáltatás átmenetileg nem elérhető. Kérjük, próbálja újra néhány perc múlva.",
      503,
    );
  }

  const inserted = await insertOrder(c.env, {
    id: orderId,
    publicId,
    resultTokenHash,
    email: input.email.toLowerCase(),
    name: input.name,
    letterType: input.letterType,
    recipient: input.recipient,
    problemDescription: input.problemDescription,
    desiredResult: input.desiredResult,
    tone: input.tone,
    previousMessages: input.previousMessages,
    selectedPackage: input.selectedPackage,
    price: price.payableAmount,
    currency: price.currency,
    paymentStatus: "pending",
    checkoutIdempotencyKey: input.checkoutAttemptId,
    checkoutInputHash: inputFingerprint,
    billing: input.billing,
  });
  if (!inserted) {
    const racedOrder = await getOrderByCheckoutIdempotencyKey(
      c.env,
      input.checkoutAttemptId,
    );
    if (!racedOrder || racedOrder.checkout_input_hash !== inputFingerprint) {
      return errorJson(c, "IDEMPOTENCY_CONFLICT", "Ütköző fizetési kísérlet.", 409);
    }
    orderId = racedOrder.id;
    publicId = racedOrder.public_id;
    if (racedOrder.payment_status === "paid") {
      return errorJson(c, "ORDER_ALREADY_PAID", "Ez a rendelés már ki lett fizetve.", 409);
    }
    if (racedOrder.stripe_session_id) {
      const racedSession = await retrieveCheckoutSession(c.env, racedOrder.stripe_session_id);
      if (racedSession.status === "open" && racedSession.url) {
        return okJson(c, { checkoutUrl: racedSession.url, publicId });
      }
      return errorJson(c, "CHECKOUT_NOT_PAYABLE", "A fizetés már nem indítható el.", 409);
    }
  }
  logEvent("order_created", { orderId, publicId, packageId: input.selectedPackage });

  const session = await createCheckoutSession(c.env, {
    packageId: input.selectedPackage,
    packageName: selectedPackage.name,
    amount: price.payableAmount,
    currency: price.currency,
    email: input.billing.email.toLowerCase(),
    orderId,
    publicId,
    resultToken,
  });

  if (!session.url) {
    throw new Error("Stripe session URL missing.");
  }

  const attached = await attachStripeSession(c.env, orderId, session.id);
  if (!attached) {
    throw new Error("Stripe session could not be attached to the order.");
  }
  logEvent("stripe_session_created", { orderId, stripeSessionId: session.id });

  return okJson(c, {
    checkoutUrl: session.url,
    publicId,
  });
}
