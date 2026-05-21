import type { Context, Next } from "hono";
import type { Env } from "./types";

function parseAllowedOrigins(rawValue: string) {
  return rawValue
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null, env: Env) {
  if (!origin) {
    return false;
  }
  return parseAllowedOrigins(env.ALLOWED_ORIGINS).includes(origin);
}

export function addSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const maxJsonBodyBytes = 64 * 1024;
const maxWebhookBodyBytes = 256 * 1024;

export async function bodySizeGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const path = new URL(c.req.url).pathname;
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  const limit = path === "/api/stripe/webhook" ? maxWebhookBodyBytes : maxJsonBodyBytes;

  if (contentLength > limit) {
    return noStoreJson(c, { error: "A kérés túl nagy." }, 413);
  }

  await next();
}

export async function corsGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const origin = c.req.header("Origin") ?? null;
  const path = new URL(c.req.url).pathname;

  if (
    path.startsWith("/api/") &&
    path !== "/api/stripe/webhook" &&
    origin &&
    !isAllowedOrigin(origin, c.env)
  ) {
    return c.json({ error: "Tiltott origin." }, 403);
  }

  if (c.req.method === "OPTIONS") {
    if (!origin || !isAllowedOrigin(origin, c.env)) {
      return c.body(null, 403);
    }
    return c.body(null, 204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
  }

  await next();

  if (origin && isAllowedOrigin(origin, c.env)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
}

type JsonStatus = 200 | 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503;

export function noStoreJson(
  c: Context,
  payload: unknown,
  status: JsonStatus = 200,
) {
  c.header("Cache-Control", "no-store");
  return c.json(payload, status);
}

/**
 * Enforces `Content-Type: application/json` on all mutating API requests
 * except the Stripe webhook (which is handled separately with a raw body
 * read and its own signature verification).
 */
export async function requireJsonContentType(
  c: Context<{ Bindings: Env }>,
  next: Next,
) {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  if (
    (method === "POST" || method === "PUT" || method === "PATCH") &&
    path !== "/api/stripe/webhook"
  ) {
    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
      return noStoreJson(c, { error: "Hibás Content-Type. application/json szükséges." }, 400);
    }
  }

  await next();
}
