import type { Env } from "./types";
import { getGenerationModel, getReviewModel } from "./geminiModels";

/**
 * Checks whether the exact generation and review models needed for an order
 * are available. Model metadata requests do not consume generation tokens.
 */
export async function checkAiServiceAvailable(
  env: Env,
  premium = false,
): Promise<boolean> {
  if (!env.GEMINI_API_KEY) {
    return false;
  }
  // Model metadata stays available while generation is rate limited or out of
  // quota, so recent real generation failures also block new charges.
  if (await isAiProviderDegraded(env)) {
    return false;
  }

  const models = new Set([
    getGenerationModel(env, premium),
    getReviewModel(env),
  ]);

  try {
    const responses = await Promise.all(
      [...models].map((model) =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
          {
            headers: { "x-goog-api-key": env.GEMINI_API_KEY },
            signal: AbortSignal.timeout(5000),
          },
        ),
      ),
    );
    return responses.every((response) => response.ok);
  } catch {
    return false;
  }
}

const DEGRADED_FAILURE_THRESHOLD = 3;
const DEGRADED_WINDOW_MS = 10 * 60_000;

export async function isAiProviderDegraded(env: Env, now = Date.now()) {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT consecutive_failures, last_failure_at FROM ai_provider_health WHERE id = 'gemini'",
    ).first<{ consecutive_failures: number; last_failure_at: string | null }>();
    return Boolean(
      row &&
      row.consecutive_failures >= DEGRADED_FAILURE_THRESHOLD &&
      row.last_failure_at &&
      Date.parse(row.last_failure_at) > now - DEGRADED_WINDOW_MS,
    );
  } catch {
    return false;
  }
}
