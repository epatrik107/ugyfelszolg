import { constantTimeEqual } from "./hash";
import type { Env, PackageId } from "./types";

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  mode: "payment" | "subscription";
  status: "open" | "complete" | "expired" | null;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  customer: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  payment_intent: string | null;
  subscription: string | null;
  metadata: Record<string, string>;
  client_reference_id: string | null;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
}

interface StripeInvoice {
  subscription: string | null;
  customer: string | null;
  status: string | null;
}

export interface StripeEvent<T = unknown> {
  id: string;
  type: string;
  livemode: boolean;
  data: {
    object: T;
  };
}

const STRIPE_TWO_DECIMAL_CHARGE_CURRENCIES = new Set(["huf"]);

export function toStripeMinorAmount(amount: number, currency: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("INVALID_STRIPE_AMOUNT");
  }
  const normalizedCurrency = currency.toLowerCase();
  return STRIPE_TWO_DECIMAL_CHARGE_CURRENCIES.has(normalizedCurrency)
    ? amount * 100
    : amount;
}

export function fromStripeMinorAmount(amount: number | null, currency: string | null) {
  if (amount === null || currency === null) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("INVALID_STRIPE_AMOUNT");
  }
  const normalizedCurrency = currency.toLowerCase();
  return STRIPE_TWO_DECIMAL_CHARGE_CURRENCIES.has(normalizedCurrency)
    ? amount / 100
    : amount;
}

function assertStripeKeyMatchesMode(env: Env) {
  const expectedPrefix = env.PAYMENT_MODE === "live" ? "sk_live_" : "sk_test_";
  if (!env.PAYMENT_MODE || !env.STRIPE_SECRET_KEY.startsWith(expectedPrefix)) {
    throw new Error("Stripe key does not match the configured payment mode.");
  }
}

async function stripeRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured.");
  }
  assertStripeKeyMatchesMode(env);

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    // Deliberately omit the Stripe response body from the error to avoid
    // leaking internal Stripe data (customer IDs, partial card numbers, etc.)
    // into application logs.
    throw new Error(`Stripe API error (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function createCheckoutSession(
  env: Env,
  input: {
    packageId: PackageId;
    packageName: string;
    amount: number;
    currency: string;
    email: string;
    orderId: string;
    publicId: string;
    resultToken: string;
  },
) {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${env.SITE_URL}/sikeres-fizetes?order=${input.publicId}&token=${input.resultToken}`);
  params.set("cancel_url", `${env.SITE_URL}/sikertelen-fizetes?order=${input.publicId}&token=${input.resultToken}`);
  params.set("customer_email", input.email);
  params.set("client_reference_id", input.orderId);
  // Keep the checkout constrained to card payments. Stripe Hosted Checkout can
  // still render eligible card wallets (Apple Pay / Google Pay) when the
  // customer's browser, device and wallet setup supports them, while avoiding
  // accidental non-card payment methods from Dashboard configuration drift.
  params.set("payment_method_types[0]", "card");
  params.set("metadata[orderId]", input.orderId);
  params.set("metadata[publicId]", input.publicId);
  params.set("metadata[selectedPackage]", input.packageId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", input.currency);
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(toStripeMinorAmount(input.amount, input.currency)),
  );
  params.set("line_items[0][price_data][tax_behavior]", "inclusive");
  params.set("line_items[0][price_data][product_data][name]", input.packageName);

  params.set("payment_intent_data[metadata][orderId]", input.orderId);
  params.set("payment_intent_data[metadata][selectedPackage]", input.packageId);

  return stripeRequest<StripeCheckoutSession>(env, "/checkout/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Prevent duplicate sessions if the client retries the same order
      "Idempotency-Key": `checkout-${input.orderId}`,
    },
    body: params,
  });
}

export async function retrieveCheckoutSession(env: Env, sessionId: string) {
  return stripeRequest<StripeCheckoutSession>(
    env,
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function expireCheckoutSession(env: Env, sessionId: string) {
  return stripeRequest<StripeCheckoutSession>(
    env,
    `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    {
      method: "POST",
      headers: { "Idempotency-Key": `expire-${sessionId}` },
    },
  );
}

export async function retrieveSubscription(env: Env, subscriptionId: string) {
  return stripeRequest<StripeSubscription>(env, `/subscriptions/${subscriptionId}`);
}

export async function createRefund(env: Env, paymentIntentId: string) {
  const params = new URLSearchParams({ payment_intent: paymentIntentId });
  return stripeRequest<{ id: string; status: string; amount?: number; currency?: string }>(env, "/refunds", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `refund-${paymentIntentId}`,
    },
    body: params,
  });
}

function parseStripeSignature(signatureHeader: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  return { timestamp, signatures };
}

async function computeSignature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
) {
  if (!signatureHeader) {
    return null;
  }

  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    return null;
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds
  ) {
    return null;
  }

  const expected = await computeSignature(secret, `${timestamp}.${rawBody}`);
  const isValid = signatures.some((signature) =>
    constantTimeEqual(signature, expected),
  );
  if (!isValid) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as Partial<StripeEvent<unknown>>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.type !== "string" ||
      typeof parsed.livemode !== "boolean" ||
      !parsed.data ||
      typeof parsed.data !== "object" ||
      !("object" in parsed.data)
    ) {
      return null;
    }
    return parsed as StripeEvent<
      StripeCheckoutSession | StripeSubscription | StripeInvoice
    >;
  } catch {
    return null;
  }
}
