import { fileURLToPath } from "node:url";

const REQUIRED_SECURITY_HEADERS = [
  "content-security-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
];

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function validateHealthUrl(rawUrl) {
  const url = new URL(rawUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("API_HEALTH_URL must use HTTPS outside local development.");
  }
  if (url.pathname !== "/api/health") {
    throw new Error("API_HEALTH_URL must point to /api/health.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API_HEALTH_URL must not contain credentials, a query, or a fragment.");
  }
  return url;
}

export async function checkDeploymentHealth({
  healthUrl,
  fetchImpl = fetch,
  attempts = 6,
  delayMs = 3_000,
}) {
  const url = validateHealthUrl(healthUrl);
  let lastFailure = "unknown";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(5_000),
      });
      const payload = await response.json().catch(() => null);
      const missingHeaders = REQUIRED_SECURITY_HEADERS.filter(
        (header) => !response.headers.get(header),
      );

      if (response.status === 200 && payload?.status === "ok" && missingHeaders.length === 0) {
        return { ok: true, attempt };
      }
      lastFailure = `status=${response.status}, health=${payload?.status ?? "invalid"}, missingHeaders=${missingHeaders.join(",") || "none"}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "network error";
    }

    if (attempt < attempts) await wait(delayMs);
  }

  throw new Error(`Deployment health check failed after ${attempts} attempts (${lastFailure}).`);
}

export async function run(env = process.env) {
  const healthUrl = String(env.API_HEALTH_URL ?? "").trim();
  if (!healthUrl) {
    console.error("Deployment health check failed: API_HEALTH_URL is missing.");
    return 1;
  }

  try {
    const result = await checkDeploymentHealth({ healthUrl });
    console.log(`Deployment health check passed on attempt ${result.attempt}.`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployment health check failed.");
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run();
}
