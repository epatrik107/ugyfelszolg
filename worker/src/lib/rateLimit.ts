import type { Context } from "hono";
import type { Env } from "./types";
import { hashToken } from "./hash";
import { logEvent } from "./logger";

export type RateLimitScope =
  | "create-checkout-ip"
  | "create-checkout-email"
  | "cancel-checkout-ip"
  | "result-ip"
  | "result-order"
  | "contact-ip"
  | "contact-email"
  | "regenerate-ip"
  | "send-letter-ip"
  | "admin-ip";

export const RATE_LIMITS: Record<
  RateLimitScope,
  { limit: number; windowSeconds: number }
> = {
  "create-checkout-ip": { limit: 5, windowSeconds: 600 },
  "create-checkout-email": { limit: 5, windowSeconds: 600 },
  "cancel-checkout-ip": { limit: 10, windowSeconds: 600 },
  "result-ip": { limit: 600, windowSeconds: 600 },
  "result-order": { limit: 120, windowSeconds: 600 },
  "contact-ip": { limit: 3, windowSeconds: 600 },
  "contact-email": { limit: 3, windowSeconds: 600 },
  "regenerate-ip": { limit: 10, windowSeconds: 600 },
  "send-letter-ip": { limit: 10, windowSeconds: 600 },
  "admin-ip": { limit: 30, windowSeconds: 600 },
};

async function getWindowKey(env: Env, scope: RateLimitScope, identifier: string, now: Date) {
  const bucket = Math.floor(now.getTime() / 1000 / RATE_LIMITS[scope].windowSeconds);
  const identifierHash = await hashToken(`${scope}:${identifier}`, env.TOKEN_HASH_SECRET);
  return `ratelimit:${scope}:${identifierHash}:${bucket}`;
}

export function getClientIp(c: Context<{ Bindings: Env }>) {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export async function isRateLimited(
  env: Env,
  scope: RateLimitScope,
  identifier: string,
  now = new Date(),
) {
  if (!env.DB || !env.TOKEN_HASH_SECRET) {
    logEvent("rate_limit_configuration_missing", { scope });
    return true;
  }
  try {
    const rule = RATE_LIMITS[scope];
    const key = await getWindowKey(env, scope, identifier, now);
    const expiry = (Math.floor(now.getTime() / 1000 / rule.windowSeconds) + 1) * rule.windowSeconds;
    const accepted = await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ?
       RETURNING count`,
    ).bind(key, expiry, rule.limit).first<{ count: number }>();
    if (!accepted) logEvent("rate_limited", { scope });
    return !accepted;
  } catch {
    logEvent("rate_limit_storage_unavailable", { scope });
    return true;
  }
}
