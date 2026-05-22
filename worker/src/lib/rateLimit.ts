import type { Context } from "hono";
import type { Env } from "./types";

export type RateLimitScope =
  | "create-checkout-ip"
  | "create-checkout-email"
  | "result-ip"
  | "contact-ip"
  | "contact-email"
  | "business-access-ip"
  | "business-magic-ip"
  | "business-session-ip"
  | "regenerate-ip";

export const RATE_LIMITS: Record<
  RateLimitScope,
  { limit: number; windowSeconds: number }
> = {
  "create-checkout-ip": { limit: 5, windowSeconds: 600 },
  "create-checkout-email": { limit: 5, windowSeconds: 600 },
  "result-ip": { limit: 60, windowSeconds: 600 },
  "contact-ip": { limit: 3, windowSeconds: 600 },
  "contact-email": { limit: 3, windowSeconds: 600 },
  "business-access-ip": { limit: 5, windowSeconds: 600 },
  "business-magic-ip": { limit: 10, windowSeconds: 600 },
  "business-session-ip": { limit: 60, windowSeconds: 600 },
  "regenerate-ip": { limit: 10, windowSeconds: 600 },
};

function getWindowKey(scope: RateLimitScope, identifier: string, now: Date) {
  const bucket = Math.floor(now.getTime() / 1000 / RATE_LIMITS[scope].windowSeconds);
  return `ratelimit:${scope}:${identifier}:${bucket}`;
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
  if (!env.RATE_LIMIT_KV) {
    return false;
  }

  const rule = RATE_LIMITS[scope];
  const key = getWindowKey(scope, identifier, now);
  const current = Number(await env.RATE_LIMIT_KV.get(key)) || 0;

  if (current >= rule.limit) {
    return true;
  }

  await env.RATE_LIMIT_KV.put(String(key), String(current + 1), {
    expirationTtl: rule.windowSeconds + 5,
  });
  return false;
}
