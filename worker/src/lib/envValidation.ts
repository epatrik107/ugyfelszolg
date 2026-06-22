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
] as const;

/** Keys only required when not in demo-only mode (demo bypasses Turnstile via access code) */
const nonDemoRequiredKeys = [
  "TURNSTILE_SECRET_KEY",
] as const;

function hasValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function missingKeys(env: Env, keys: readonly (keyof Env)[]) {
  return keys.filter((key) => !hasValue(env[key])).map(String);
}

function isPaymentsEnabled(env: Env) {
  return env.PAYMENTS_ENABLED === "true";
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
  }

  if (isPaymentsEnabled(env)) {
    missing.push(
      ...missingKeys(env, [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "SZAMLAZZ_AGENT_KEY",
      ]),
    );
    if (
      typeof env.SZAMLAZZ_AGENT_KEY === "string" &&
      env.SZAMLAZZ_AGENT_KEY !== env.SZAMLAZZ_AGENT_KEY.toLowerCase()
    ) {
      missing.push("SZAMLAZZ_AGENT_KEY_LOWERCASE");
    }
    missing.push(...validatePaymentMode(env));
  }

  if (isDemoOnlyMode(env)) {
    missing.push(...missingKeys(env, ["DEMO_ACCESS_CODE"]));
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
