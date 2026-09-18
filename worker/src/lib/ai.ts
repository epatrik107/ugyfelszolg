import {
  commitReservedQuota,
  completeGeneration,
  deferGeneration,
  failGeneration,
  getLetterEmailVersionKey,
  hasLetterEmailVersionSent,
  markLetterEmailSent,
} from "./db";
import { EmailSendError, sendGeneratedLetterEmail } from "./email";
import { logEvent } from "./logger";
import { getGenerationModel, getReviewModel } from "./geminiModels";
import { getPackage } from "./packages";
import { reviewRevisionScope } from "./revision";
import { ensurePoliteClosing, reviewLetterWithRules } from "./review";
import { REVIEW_CODES, REVIEW_FIELDS, type ReviewFinding } from "./reviewContract";
import { recordReviewAttempt, type ReviewObservation } from "./reviewDiagnostics";
import type { Env, OrderRow } from "./types";

import { buildUserPrompt, buildReviewPrompt, GENERATION_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT, PROMPT_VERSION } from "./prompts";
export { buildUserPrompt } from "./prompts";

/** Max characters we accept from the AI before rejecting the output */
const MAX_AI_OUTPUT_CHARS = 12_000;
const GEMINI_GENERATION_TIMEOUT_MS = 25_000;
const AI_REVIEW_TIMEOUT_MS = 15_000;
const AI_REVIEW_MAX_ATTEMPTS = 2;
const AI_REVIEW_RETRY_BACKOFF_MS = 50;

export const GENERATION_PROVIDER_UNAVAILABLE_MESSAGE =
  "A levélgeneráló szolgáltatás tartósan nem volt elérhető, ezért a rendelést automatikusan visszatérítjük.";

export const AI_REVIEW_UNAVAILABLE_MESSAGE =
  "A levél automatikus minőségellenőrzése átmenetileg nem érhető el. Kérjük, próbálja újra később.";

type AiReviewResult = { ok: boolean; issues: string[]; findings: ReviewFinding[] };
export const MAX_LETTER_ATTEMPTS = 2;

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

  if (typeof parsed !== "object" || parsed === null ||
      typeof (parsed as { ok?: unknown }).ok !== "boolean" ||
      !Array.isArray((parsed as { issues?: unknown }).issues)) {
    throw new AiReviewFailure("schema_invalid", false);
  }
  const result = parsed as { ok: boolean; issues: unknown[] };
  if (result.issues.length > 8 || (result.ok ? result.issues.length !== 0 : result.issues.length === 0)) {
    throw new AiReviewFailure("inconsistent_result", false);
  }
  const findings: ReviewFinding[] = result.issues.map((item) => {
    if (!item || typeof item !== "object") throw new AiReviewFailure("schema_invalid", false);
    const finding = item as ReviewFinding;
    if (!REVIEW_CODES.includes(finding.code) || !REVIEW_FIELDS.includes(finding.field) ||
        typeof finding.instruction !== "string" || !finding.instruction.trim() || finding.instruction.length > 300) {
      throw new AiReviewFailure("schema_invalid", false);
    }
    return { code: finding.code, field: finding.field, instruction: finding.instruction };
  });
  return { ok: result.ok, findings, issues: findings.map((f) => `[${f.code}/${f.field}] ${f.instruction}`) };
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
    throw new AiProviderError("output_too_long", false);
  }
  // Strip null bytes and non-printable ASCII control chars (0x01-0x08,
  // 0x0B-0x0C, 0x0E-0x1F, 0x7F) but keep \t (0x09), \n (0x0A), \r (0x0D).
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const AI_PROVIDER_HEALTH_ID = "gemini";

/** Distinguishes provider outages (retry later) from requests that can never succeed. */
export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AiProviderError";
  }
}

export function isRetryableAiFailure(error: unknown) {
  return (error instanceof AiProviderError || error instanceof AiReviewFailure) && error.retryable;
}

export async function recordAiProviderFailure(env: Env, code: string) {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO ai_provider_health (id, consecutive_failures, last_failure_at, last_error)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET consecutive_failures = consecutive_failures + 1,
         last_failure_at = excluded.last_failure_at, last_error = excluded.last_error`,
    ).bind(AI_PROVIDER_HEALTH_ID, now, code.slice(0, 80)).run();
  } catch {
    logEvent("ai_provider_health_write_failed", {});
  }
}

export async function recordAiProviderSuccess(env: Env) {
  try {
    await env.DB.prepare(
      `UPDATE ai_provider_health SET consecutive_failures = 0, last_success_at = ?
       WHERE id = ? AND consecutive_failures > 0`,
    ).bind(new Date().toISOString(), AI_PROVIDER_HEALTH_ID).run();
  } catch {
    logEvent("ai_provider_health_write_failed", {});
  }
}

export async function callGemini(env: Env, model: string, input: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: GENERATION_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: input }] }],
    // Gemini 3 recommends its default temperature for instruction following.
    generationConfig: { maxOutputTokens: 2048 },
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
      // A timeout already spent 25s; defer to a later scheduled run instead.
      if (isTimeoutError(fetchError)) {
        throw new AiProviderError("timeout", true);
      }
      lastError = new AiProviderError("network_error", true);
      continue;
    }

    if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
      lastError = new AiProviderError(`http_${response.status}`, true);
      continue;
    }

    if (!response.ok) {
      // Invalid key, disabled billing or a rejected request will not heal by retrying.
      throw new AiProviderError(`http_${response.status}`, false);
    }

    const payload = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    } | null;
    if (!payload) {
      throw new AiProviderError("malformed_response", true);
    }
    if (payload.promptFeedback?.blockReason) {
      throw new AiProviderError("prompt_blocked", false);
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new AiProviderError("empty_response", true);
    }
    return text;
  }

  throw lastError ?? new AiProviderError("retries_exhausted", true);
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
          responseMimeType: "application/json", maxOutputTokens: 2048,
          responseSchema: {
            type: "OBJECT", properties: {
              ok: { type: "BOOLEAN" },
              issues: { type: "ARRAY", maxItems: 8, items: {
                type: "OBJECT", properties: {
                  code: { type: "STRING", enum: [...REVIEW_CODES] },
                  field: { type: "STRING", enum: [...REVIEW_FIELDS] },
                  instruction: { type: "STRING" },
                }, required: ["code", "field", "instruction"],
              } },
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
      const review = await reviewWithAiOnce(env, order, letter, regenerationFeedback);
      const scopeIssues = reviewRevisionScope(order.generated_letter, letter, regenerationFeedback);
      const findings: ReviewFinding[] = [...review.findings, ...scopeIssues.map((instruction) => ({
        code: "revision_scope" as const, field: "whole" as const, instruction,
      }))];
      return { ok: review.ok && scopeIssues.length === 0, issues: [...review.issues, ...scopeIssues], findings };
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

/** Shared by paid fulfillment and synthetic release evaluation; no payments or DB writes. */
export async function generateReviewedLetter(
  env: Env, order: OrderRow, regenerationFeedback?: string,
  observe: (observation: ReviewObservation) => Promise<unknown> = async () => {},
) {
  const model = getGenerationModel(env, getPackage(order.selected_package).capabilities.isPremiumModel);
  let reviewIssues: string[] = [];
  let revisionBase: string | undefined;
  for (let attempt = 0; attempt < MAX_LETTER_ATTEMPTS; attempt += 1) {
    const raw = await callGemini(env, model, buildUserPrompt(order, reviewIssues, regenerationFeedback, revisionBase));
    const letter = validateAiOutput(ensurePoliteClosing(raw, order.name));
    const ruleReview = reviewLetterWithRules(letter);
    if (ruleReview.warnings.length) logEvent("ai_review_warning", { orderId: order.id, attempt, warnings: ruleReview.warnings });
    let review: AiReviewResult;
    try {
      review = await reviewWithAi(env, order, letter, regenerationFeedback);
    } catch (error) {
      await observe({ attempt, outcome: "unavailable", findings: [], ruleBlockerCount: ruleReview.blockers.length });
      logEvent("ai_review_gate_failed", { orderId: order.id, attempt, reason: error instanceof AiReviewFailure ? error.code : "unknown" });
      throw error;
    }
    const approved = ruleReview.ok && review.ok;
    await observe({ attempt, outcome: approved ? "approved" : "rejected", findings: review.findings, ruleBlockerCount: ruleReview.blockers.length });
    logEvent("ai_review_decision", {
      orderId: order.id, attempt, approved, promptVersion: PROMPT_VERSION,
      findings: review.findings.map(({ code, field }) => ({ code, field })), ruleBlockers: ruleReview.blockers,
    });
    if (approved) return { letter, attempts: attempt + 1 };
    reviewIssues = [...ruleReview.blockers, ...review.issues];
    revisionBase = letter;
  }
  return { letter: null, attempts: MAX_LETTER_ATTEMPTS };
}

export async function generateLetterForPaidOrder(env: Env, order: OrderRow, regenerationFeedback?: string) {
  async function handleFailure(status: "failed" | "failed_review", message: string, reason: string) {
    const failureRecorded = await failGeneration(env, order.id, status, message, order.subscription_id, order.generation_run_id ?? null);
    logEvent(failureRecorded ? "ai_generation_failed" : "ai_generation_failure_state_unchanged", { orderId: order.id, reason });
  }
  async function handleTransientFailure(error: Error) {
    const code = error.message.slice(0, 80);
    await recordAiProviderFailure(env, code);
    const outcome = await deferGeneration(env, order, code);
    if (outcome === "deferred") {
      logEvent("ai_generation_deferred", { orderId: order.id, reason: code, retry: (order.generation_retry_count ?? 0) + 1 });
    } else if (outcome === "exhausted") {
      await handleFailure("failed", GENERATION_PROVIDER_UNAVAILABLE_MESSAGE, `retries_exhausted_${code}`);
    } else {
      logEvent("ai_generation_failure_state_unchanged", { orderId: order.id, reason: code });
    }
  }
  try {
    logEvent("ai_generation_started", { orderId: order.id, promptVersion: PROMPT_VERSION });
    const runId = order.generation_run_id ?? crypto.randomUUID();
    const result = await generateReviewedLetter(env, order, regenerationFeedback,
      async (observation) => {
        await recordReviewAttempt(env, order, runId, observation);
        // Both provider stages answered: a content rejection is not an outage.
        if (observation.outcome !== "unavailable") await recordAiProviderSuccess(env);
      });
    if (!result.letter) {
      await handleFailure("failed_review", "Automatikus minőségellenőrzés sikertelen.", "review_failed");
      return;
    }
    const completed = await completeGeneration(env, order.id, result.letter, order.generated_letter, order.generation_run_id ?? null);
    if (!completed) {
      logEvent("ai_generation_completion_state_unchanged", { orderId: order.id });
      return;
    }
    if (order.subscription_id) await commitReservedQuota(env, order.subscription_id);
    await sendGeneratedLetterEmailIfConfigured(env, order, result.letter);
    logEvent("ai_generation_completed", { orderId: order.id });
  } catch (error) {
    if (isRetryableAiFailure(error)) {
      await handleTransientFailure(error as Error);
    } else if (error instanceof AiReviewFailure) {
      await handleFailure("failed_review", AI_REVIEW_UNAVAILABLE_MESSAGE, "ai_review_unavailable");
    } else if (error instanceof AiProviderError) {
      await handleFailure("failed", "Generálási hiba.", error.code);
    } else {
      // Storage faults retain the lease for durable recovery, never immediate refund.
      throw error;
    }
  }
}
