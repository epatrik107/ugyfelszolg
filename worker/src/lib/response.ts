import type { Context } from "hono";

type JsonStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503;

/** Uniform success response: `{ ok: true, data }` with Cache-Control: no-store. */
export function okJson<T extends Record<string, unknown>>(
  c: Context,
  data: T,
  status: JsonStatus = 200,
) {
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true as const, data }, status);
}

/** Uniform error response: `{ ok: false, error: { code, message } }` with Cache-Control: no-store. */
export function errorJson(
  c: Context,
  code: string,
  message: string,
  status: JsonStatus,
) {
  c.header("Cache-Control", "no-store");
  return c.json({ ok: false as const, error: { code, message } }, status);
}
