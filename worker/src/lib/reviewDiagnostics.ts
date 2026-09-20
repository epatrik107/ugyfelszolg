import { getGenerationModel, getReviewModel } from "./geminiModels";
import { getPackage } from "./packages";
import { PROMPT_VERSION } from "./prompts";
import { REVIEW_CODES, REVIEW_FIELDS, type ReviewFinding } from "./reviewContract";
import type { Env, OrderRow } from "./types";

export type ReviewObservation = {
  attempt: number;
  outcome: "approved" | "rejected" | "unavailable";
  findings: ReviewFinding[];
  ruleBlockerCount: number;
};

export async function recordReviewAttempt(env: Env, order: OrderRow, runId: string, observation: ReviewObservation) {
  // Construct an allow-listed projection; never persist instructions or candidates.
  const findings = observation.findings.map(({ code, field }) => {
    if (!REVIEW_CODES.includes(code) || !REVIEW_FIELDS.includes(field)) throw new Error("Invalid review classification");
    return { code, field };
  });
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO generation_reviews
      (id, order_id, run_id, generation_number, attempt, outcome, findings_json,
       rule_blocker_count, generation_model, review_model, prompt_version, created_at)
     SELECT ?, id, ?, generation_count, ?, ?, ?, ?, ?, ?, ?, ? FROM orders
     WHERE id = ? AND ai_status = 'generating' AND generation_run_id IS ?
       AND payment_status IN ('paid', 'partially_refunded')
       AND personal_data_redacted_at IS NULL AND created_at >= ?`,
  ).bind(
    crypto.randomUUID(), runId, observation.attempt, observation.outcome, JSON.stringify(findings),
    observation.ruleBlockerCount, getGenerationModel(env, getPackage(order.selected_package).capabilities.isPremiumModel),
    getReviewModel(env), PROMPT_VERSION, new Date().toISOString(), order.id, order.generation_run_id ?? null,
    new Date(Date.now() - 90 * 86400_000).toISOString(),
  ).run();
  return result.meta.changes === 1;
}
