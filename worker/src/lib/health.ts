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

  const models = new Set([
    getGenerationModel(env, premium),
    getReviewModel(env),
  ]);

  try {
    const responses = await Promise.all(
      [...models].map((model) =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${env.GEMINI_API_KEY}`,
          { signal: AbortSignal.timeout(5000) },
        ),
      ),
    );
    return responses.every((response) => response.ok);
  } catch {
    return false;
  }
}
