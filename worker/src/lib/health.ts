import type { Env } from "./types";

/**
 * Checks whether the Gemini API is reachable by calling the models list
 * endpoint. This is a lightweight check (no token usage) that confirms
 * the API key is valid and the service responds.
 */
export async function checkAiServiceAvailable(env: Env): Promise<boolean> {
  if (!env.GEMINI_API_KEY) {
    return false;
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}&pageSize=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}
