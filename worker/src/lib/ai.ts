import {
  commitReservedQuota,
  completeGeneration,
  failGeneration,
  getLetterEmailVersionKey,
  hasLetterEmailVersionSent,
  markLetterEmailSent,
} from "./db";
import { EmailSendError, sendGeneratedLetterEmail } from "./email";
import { logEvent } from "./logger";
import { getGenerationModel, getReviewModel } from "./geminiModels";
import { getPackage } from "./packages";
import { reviewLetterWithRules } from "./review";
import type { Env, OrderRow } from "./types";

import { buildUserPrompt, buildReviewPrompt, GENERATION_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT, PROMPT_VERSION } from "./prompts";
export { buildUserPrompt } from "./prompts";

/** Max characters we accept from the AI before rejecting the output */
const MAX_AI_OUTPUT_CHARS = 12_000;
const GEMINI_GENERATION_TIMEOUT_MS = 25_000;
const AI_REVIEW_TIMEOUT_MS = 15_000;
const AI_REVIEW_MAX_ATTEMPTS = 2;
const AI_REVIEW_RETRY_BACKOFF_MS = 50;

export const AI_REVIEW_UNAVAILABLE_MESSAGE =
  "A levél automatikus minőségellenőrzése átmenetileg nem érhető el. Kérjük, próbálja újra később.";

type AiReviewResult = { ok: boolean; issues: string[] };

class AiReviewFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AiReviewFailure";
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendGeneratedLetterEmailIfConfigured(
  env: Env,
  order: OrderRow,
  letter: string,
) {
  if (!getPackage(order.selected_package).capabilities.sendsEmailByDefault || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return;
  }
  const versionKey = await getLetterEmailVersionKey(letter);
  if (hasLetterEmailVersionSent(order, versionKey)) {
    return;
  }

  try {
    const emailResult = await sendGeneratedLetterEmail(env, order, letter);
    await markLetterEmailSent(env, order.id, versionKey);
    logEvent("letter_email_sent_auto", {
      orderId: order.id,
      delivered: Boolean(emailResult?.providerMessageId),
    });
  } catch (error) {
    logEvent("letter_email_send_failed", {
      orderId: order.id,
      errorType: error instanceof Error ? error.name : "unknown",
      providerStatus: error instanceof EmailSendError ? error.status : null,
    });
  }
}

function parseAiReviewJson(raw: string): AiReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiReviewFailure("malformed_json", false);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { ok?: unknown }).ok !== "boolean" ||
    !Array.isArray((parsed as { issues?: unknown }).issues) ||
    !(parsed as { issues: unknown[] }).issues.every((issue) => typeof issue === "string")
  ) {
    throw new AiReviewFailure("schema_invalid", false);
  }

  const result = parsed as { ok: boolean; issues: string[] };
  if (result.issues.length > 8 || result.issues.some((issue) => !issue.trim() || issue.length > 300) || (result.ok && result.issues.length > 0)) {
    throw new AiReviewFailure("inconsistent_result", false);
  }
  return {
    ok: result.ok,
    issues:
      result.ok || result.issues.length > 0
        ? result.issues
        : ["Az AI minőségellenőrzés blokkolta a levelet."],
  };
}

/**
 * Validates and lightly sanitises raw AI output before it is written to
 * the database or returned to callers.
 *
 * - Rejects outputs that exceed the character cap (guards against runaway
 *   token usage and oversized DB writes).
 * - Strips null bytes and non-printable ASCII control characters that could
 *   cause issues in downstream consumers, while preserving legitimate
 *   whitespace (newline, carriage-return, tab).
 */
export function validateAiOutput(text: string): string {
  if (text.length > MAX_AI_OUTPUT_CHARS) {
    throw new Error(`AI kimenet túl hosszú: ${text.length} karakter (limit: ${MAX_AI_OUTPUT_CHARS})`);
  }
  // Strip null bytes and non-printable ASCII control chars (0x01-0x08,
  // 0x0B-0x0C, 0x0E-0x1F, 0x7F) but keep \t (0x09), \n (0x0A), \r (0x0D).
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2000;

async function callGemini(env: Env, model: string, input: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: GENERATION_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: input }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const delayMs = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logEvent("gemini_retry", { attempt, delayMs, model });
      await wait(delayMs);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        signal: AbortSignal.timeout(GEMINI_GENERATION_TIMEOUT_MS),
        body,
      });
    } catch (fetchError) {
      lastError = fetchError instanceof Error ? fetchError : new Error("Network error");
      if (isTimeoutError(fetchError)) {
        throw lastError;
      }
      continue;
    }

    if (response.status === 429 && attempt < GEMINI_MAX_RETRIES) {
      lastError = new Error("Gemini API kvóta átmenetileg kimerült (429).");
      continue;
    }

    if (!response.ok) {
      throw new Error(`Gemini API error (${response.status})`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new Error("Gemini empty response.");
    }
    return text;
  }

  throw lastError ?? new Error("Gemini API error after retries.");
}

async function reviewWithAiOnce(env: Env, order: OrderRow, letter: string, regenerationFeedback?: string): Promise<AiReviewResult> {
  const model = getReviewModel(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      signal: AbortSignal.timeout(AI_REVIEW_TIMEOUT_MS),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: REVIEW_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildReviewPrompt(order, letter, regenerationFeedback) }] }],
        generationConfig: {
          responseMimeType: "application/json", maxOutputTokens: 1024, temperature: 0,
          responseSchema: {
            type: "OBJECT", properties: {
              ok: { type: "BOOLEAN" },
              issues: { type: "ARRAY", items: { type: "STRING" } },
            }, required: ["ok", "issues"],
          },
        },
      }),
    });
  } catch (error) {
    throw new AiReviewFailure(isTimeoutError(error) ? "timeout" : "network_error", true);
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new AiReviewFailure(`http_${response.status}`, retryable);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!raw) {
    throw new AiReviewFailure("empty_response", false);
  }
  return parseAiReviewJson(raw);
}

/**
 * Secondary AI review is an intentional fail-closed security gate. Transient
 * provider failures get one bounded retry; malformed or schema-invalid review
 * output blocks generation immediately instead of falling back to rule-only review.
 */
export async function reviewWithAi(env: Env, order: OrderRow, letter: string, regenerationFeedback?: string): Promise<AiReviewResult> {
  let lastFailure: AiReviewFailure | null = null;

  for (let attempt = 0; attempt < AI_REVIEW_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await reviewWithAiOnce(env, order, letter, regenerationFeedback);
    } catch (error) {
      const failure =
        error instanceof AiReviewFailure
          ? error
          : new AiReviewFailure("unexpected_error", false);
      lastFailure = failure;

      if (!failure.retryable || attempt === AI_REVIEW_MAX_ATTEMPTS - 1) {
        throw failure;
      }

      logEvent("ai_review_retry", { attempt, reason: failure.code });
      await wait(AI_REVIEW_RETRY_BACKOFF_MS);
    }
  }

  throw lastFailure ?? new AiReviewFailure("unexpected_error", false);
}

export async function generateLetterForPaidOrder(
  env: Env,
  order: OrderRow,
  regenerationFeedback?: string,
) {
  const pkg = getPackage(order.selected_package);
  const model = getGenerationModel(env, pkg.capabilities.isPremiumModel);

  async function handleFailure(status: "failed" | "failed_review", message: string, reason: string) {
    const failureRecorded = await failGeneration(env, order.id, status, message, order.subscription_id, order.generation_run_id ?? null);
    if (!failureRecorded) {
      logEvent("ai_generation_failure_state_unchanged", { orderId: order.id, reason });
      return;
    }
    logEvent("ai_generation_failed", { orderId: order.id, reason });

    // failGeneration atomically records the refund intent; the scheduler retries it.

  }

  try {
    logEvent("ai_generation_started", { orderId: order.id, promptVersion: PROMPT_VERSION });
    let reviewIssues: string[] = [];
    let revisionBase: string | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const letter = await callGemini(
        env,
        model,
        buildUserPrompt(order, reviewIssues, regenerationFeedback, revisionBase),
      );
      const ruleReview = reviewLetterWithRules(letter);

      if (ruleReview.warnings.length > 0) {
        logEvent("ai_review_warning", { orderId: order.id, attempt, warnings: ruleReview.warnings });
      }

      // AI review is a fail-closed security gate; warnings are advisory.
      let aiBlockers: string[] = [];
      try {
        const aiReview = await reviewWithAi(env, order, letter, regenerationFeedback);
        if (!aiReview.ok) {
          aiBlockers = aiReview.issues;
          logEvent("ai_review_blocker", { orderId: order.id, attempt, issueCount: aiReview.issues.length });
        }
        reviewIssues = [...ruleReview.blockers, ...aiBlockers];
        revisionBase = letter;
      } catch (reviewErr) {
        logEvent("ai_review_gate_failed", {
          orderId: order.id,
          attempt,
          reason: reviewErr instanceof AiReviewFailure ? reviewErr.code : "unknown",
        });
        await handleFailure(
          "failed_review",
          AI_REVIEW_UNAVAILABLE_MESSAGE,
          "ai_review_unavailable",
        );
        return;
      }

      if (ruleReview.ok && aiBlockers.length === 0) {
        const safeLetter = validateAiOutput(letter);
        const completed = await completeGeneration(env, order.id, safeLetter, order.generated_letter, order.generation_run_id ?? null);
        if (!completed) {
          logEvent("ai_generation_completion_state_unchanged", { orderId: order.id });
          return;
        }
        if (order.subscription_id) {
          await commitReservedQuota(env, order.subscription_id);
        }
        await sendGeneratedLetterEmailIfConfigured(env, order, safeLetter);
        logEvent("ai_generation_completed", { orderId: order.id });
        return;
      }

      logEvent("ai_review_failed", {
        orderId: order.id,
        attempt,
        ruleBlockers: ruleReview.blockers,
        aiBlockerCount: aiBlockers.length,
      });
    }

    await handleFailure("failed_review", "Automatikus minőségellenőrzés sikertelen.", "review_failed");
  } catch (error) {
    await handleFailure(
      "failed",
      "Generálási hiba.",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
