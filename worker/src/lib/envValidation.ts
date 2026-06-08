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
  "RATE_LIMIT_KV",
  "GEMINI_API_KEY",
  "TOKEN_HASH_SECRET",
  "SITE_URL",
  "ALLOWED_ORIGINS",
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

function isDemoOnlyMode(env: Env) {
  return env.DEMO_MODE === "true" && env.PAYMENTS_ENABLED !== "true";
}

export function validateEnv(env: Env): EnvValidationResult {
  const missing = [...missingKeys(env, coreRequiredKeys)];

  if (isPaymentsEnabled(env)) {
    missing.push(...missingKeys(env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]));
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
