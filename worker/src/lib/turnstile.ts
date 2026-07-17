import type { Env } from "./types";

export async function verifyTurnstileToken(
  env: Env,
  token: string,
  remoteIp?: string,
  expectedAction?: "checkout" | "contact",
) {
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });

  if (remoteIp && remoteIp !== "unknown") {
    body.set("remoteip", remoteIp);
  }

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return false;
  }

  if (!response.ok) {
    return false;
  }

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  } | null;
  if (!payload?.success) return false;

  const expectedHostnames = String(env.TURNSTILE_EXPECTED_HOSTNAMES ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  const responseHostname = payload.hostname?.trim().toLowerCase() ?? "";
  if (
    expectedHostnames.length === 0 ||
    !responseHostname ||
    !expectedHostnames.includes(responseHostname)
  ) {
    return false;
  }

  if (expectedAction && payload.action !== expectedAction) {
    return false;
  }

  return true;
}
