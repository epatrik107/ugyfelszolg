import type { Env } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite";
export const DEFAULT_GEMINI_PREMIUM_MODEL = "gemini-2.0-flash";
export const DEFAULT_GEMINI_REVIEW_MODEL = DEFAULT_GEMINI_MODEL;

const invalidModelReplacements: Record<string, string> = {
  "gemini-3.1-flash-lite": DEFAULT_GEMINI_MODEL,
  "gemini-3.5-flash": DEFAULT_GEMINI_PREMIUM_MODEL,
  "gemini-2.5-flash-lite": DEFAULT_GEMINI_MODEL,
  "gemini-2.5-flash": DEFAULT_GEMINI_PREMIUM_MODEL,
};

function normalizeModel(model: string | undefined, fallback: string) {
  const configured = model?.trim();
  return configured
    ? (invalidModelReplacements[configured] ?? configured)
    : fallback;
}

export function getGenerationModel(env: Env, premium: boolean) {
  const standardModel = normalizeModel(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
  if (!premium) {
    return standardModel;
  }
  return normalizeModel(
    env.GEMINI_MODEL_PREMIUM,
    env.GEMINI_MODEL ? standardModel : DEFAULT_GEMINI_PREMIUM_MODEL,
  );
}

export function getReviewModel(env: Env) {
  return normalizeModel(env.GEMINI_REVIEW_MODEL, DEFAULT_GEMINI_REVIEW_MODEL);
}
