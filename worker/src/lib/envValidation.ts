import type { Context, Next } from "hono";
import { logEvent } from "./logger";
import { errorJson } from "./response";
import type { Env } from "./types";

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
}

const coreRequiredKeys = [
  "DB",
  "GEMINI_API_KEY",
  "TOKEN_HASH_SECRET",
  "SITE_URL",
  "ALLOWED_ORIGINS",
  "LEGAL_TERMS_VERSION",
  "PRIVACY_POLICY_VERSION",
] as const;

/** Keys only required when not in demo-only mode (demo bypasses Turnstile via access code) */
const nonDemoRequiredKeys = [
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_HOSTNAMES",
  "RATE_LIMIT_KV",
] as const;

const MIN_TOKEN_HASH_SECRET_LENGTH = 32;
const MIN_DEMO_ACCESS_CODE_LENGTH = 16;
const MIN_ADMIN_API_TOKEN_LENGTH = 32;

function hasValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function missingKeys(env: Env, keys: readonly (keyof Env)[]) {
  return keys.filter((key) => !hasValue(env[key])).map(String);
}

function isPaymentsEnabled(env: Env) {
  return env.PAYMENTS_ENABLED === "true";
}

function isAdminApiEnabled(env: Env) {
  return env.ADMIN_API_ENABLED === "true";
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function emailFromDomain(value: string) {
  const trimmed = value.trim();
  const address = trimmed.match(/<([^<>]+)>$/u)?.[1] ?? trimmed;
  const separator = address.lastIndexOf("@");
  if (separator <= 0 || separator === address.length - 1 || /\s/u.test(address)) {
    return null;
  }
  return address.slice(separator + 1).toLowerCase();
}

function allowedOrigins(env: Env) {
  return String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function expectedTurnstileHostnames(env: Env) {
  return String(env.TURNSTILE_EXPECTED_HOSTNAMES ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
}

function isValidHostname(value: string) {
  return (
    value === "localhost" ||
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      value,
    )
  );
}

function validatePaymentMode(env: Env) {
  const errors: string[] = [];
  const mode = env.PAYMENT_MODE;

  if (mode !== "test" && mode !== "live") {
    errors.push("PAYMENT_MODE");
    return errors;
  }

  const expectedStripePrefix = mode === "test" ? "sk_test_" : "sk_live_";
  if (
    hasValue(env.STRIPE_SECRET_KEY) &&
    !env.STRIPE_SECRET_KEY.startsWith(expectedStripePrefix)
  ) {
    errors.push("STRIPE_KEY_MODE_MISMATCH");
  }
  if (
    hasValue(env.STRIPE_WEBHOOK_SECRET) &&
    !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")
  ) {
    errors.push("STRIPE_WEBHOOK_SECRET_FORMAT");
  }

  if (mode === "test" && env.SZAMLAZZ_TEST_ACCOUNT_CONFIRMED !== "true") {
    errors.push("SZAMLAZZ_TEST_ACCOUNT_CONFIRMED");
  }
  if (mode === "live" && env.SZAMLAZZ_TEST_ACCOUNT_CONFIRMED === "true") {
    errors.push("SZAMLAZZ_TEST_FLAG_IN_LIVE_MODE");
  }

  return errors;
}

function isDemoOnlyMode(env: Env) {
  return env.DEMO_MODE === "true" && env.PAYMENTS_ENABLED !== "true";
}

export function validateEnv(env: Env): EnvValidationResult {
  const missing = [...missingKeys(env, coreRequiredKeys)];

  if (!isDemoOnlyMode(env)) {
    missing.push(...missingKeys(env, nonDemoRequiredKeys));
    const hostnames = expectedTurnstileHostnames(env);
    if (hostnames.some((hostname) => !isValidHostname(hostname))) {
      missing.push("TURNSTILE_EXPECTED_HOSTNAMES_INVALID");
    }
  }

  if (
    hasValue(env.TOKEN_HASH_SECRET) &&
    String(env.TOKEN_HASH_SECRET).length < MIN_TOKEN_HASH_SECRET_LENGTH
  ) {
    missing.push("TOKEN_HASH_SECRET_MIN_LENGTH");
  }

  if (env.DEMO_MODE === "true" && isPaymentsEnabled(env)) {
    missing.push("DEMO_MODE_WITH_PAYMENTS_ENABLED");
  }

  if (env.ADMIN_API_ENABLED && !["true", "false"].includes(env.ADMIN_API_ENABLED)) {
    missing.push("ADMIN_API_ENABLED_INVALID");
  }

  if (isAdminApiEnabled(env)) {
    missing.push(...missingKeys(env, ["ADMIN_API_TOKEN"]));
    if (
      hasValue(env.ADMIN_API_TOKEN) &&
      String(env.ADMIN_API_TOKEN).length < MIN_ADMIN_API_TOKEN_LENGTH
    ) {
      missing.push("ADMIN_API_TOKEN_MIN_LENGTH");
    }
  }

  if (isPaymentsEnabled(env)) {
    missing.push(
      ...missingKeys(env, [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "SZAMLAZZ_AGENT_KEY",
        "RESEND_API_KEY",
        "EMAIL_FROM",
        "SELLER_NAME",
        "SELLER_ADDRESS",
        "SELLER_TAX_NUMBER",
      ]),
    );
    if (
      typeof env.SZAMLAZZ_AGENT_KEY === "string" &&
      env.SZAMLAZZ_AGENT_KEY !== env.SZAMLAZZ_AGENT_KEY.toLowerCase()
    ) {
      missing.push("SZAMLAZZ_AGENT_KEY_LOWERCASE");
    }
    missing.push(...validatePaymentMode(env));

    if (env.PAYMENT_MODE === "live") {
      if (isAdminApiEnabled(env)) {
        missing.push("ADMIN_API_NOT_ALLOWED_IN_LIVE_MODE");
      }
      if (hasValue(env.SITE_URL) && !isHttpsUrl(String(env.SITE_URL))) {
        missing.push("SITE_URL_HTTPS_REQUIRED");
      }
      if (allowedOrigins(env).some((origin) => !isHttpsUrl(origin))) {
        missing.push("ALLOWED_ORIGINS_HTTPS_REQUIRED");
      }
      if (
        hasValue(env.SITE_URL) &&
        isHttpsUrl(String(env.SITE_URL)) &&
        !allowedOrigins(env).includes(new URL(String(env.SITE_URL)).origin)
      ) {
        missing.push("SITE_URL_ORIGIN_NOT_ALLOWED");
      }
      if (
        hasValue(env.EMAIL_FROM) &&
        hasValue(env.SITE_URL) &&
        isHttpsUrl(String(env.SITE_URL)) &&
        emailFromDomain(String(env.EMAIL_FROM)) !==
          new URL(String(env.SITE_URL)).hostname.toLowerCase()
      ) {
        missing.push("EMAIL_FROM_DOMAIN_MISMATCH");
      }
    }
  }

  if (isDemoOnlyMode(env)) {
    missing.push(...missingKeys(env, ["DEMO_ACCESS_CODE"]));
    if (
      hasValue(env.DEMO_ACCESS_CODE) &&
      String(env.DEMO_ACCESS_CODE).length < MIN_DEMO_ACCESS_CODE_LENGTH
    ) {
      missing.push("DEMO_ACCESS_CODE_MIN_LENGTH");
    }
  }

  return { ok: missing.length === 0, missing };
}

export function logEnvValidationFailure(
  result: EnvValidationResult,
  context: "api" | "health" | "scheduled",
) {
  if (result.ok) return;
  logEvent("env_validation_failed", {
    context,
    missing: result.missing,
  });
}

export async function envValidationGuard(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health") {
    await next();
    return;
  }

  const validation = validateEnv(c.env);
  if (!validation.ok) {
    logEnvValidationFailure(validation, "api");
    return errorJson(
      c,
      "SERVICE_UNAVAILABLE",
      "A szolgáltatás átmenetileg nem elérhető. Kérjük, próbálja később.",
      503,
    );
  }

  await next();
}
