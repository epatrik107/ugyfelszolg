-- Additive migration: previous Worker versions remain rollback-compatible.
ALTER TABLE orders ADD COLUMN generation_feedback TEXT;
ALTER TABLE orders ADD COLUMN generation_claimed_at TEXT;
ALTER TABLE orders ADD COLUMN generation_run_id TEXT;
ALTER TABLE orders ADD COLUMN generation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_requested_at TEXT;
ALTER TABLE orders ADD COLUMN refund_next_attempt_at TEXT;
ALTER TABLE orders ADD COLUMN refund_claimed_at TEXT;
ALTER TABLE orders ADD COLUMN refund_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_manual_required INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_generation_jobs ON orders(ai_status, generation_claimed_at);
CREATE INDEX idx_refund_jobs ON orders(refund_manual_required, refund_next_attempt_at);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);
-- Old failures may have reached Stripe before the response was lost. Their
-- idempotency keys may have expired: reconcile manually, never issue blindly.
UPDATE orders SET refund_requested_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  refund_manual_required = 1
WHERE payment_status = 'paid' AND ai_status IN ('failed', 'failed_review')
  AND generation_count <= 1 AND generated_letter IS NULL
  AND billing_source = 'checkout' AND stripe_payment_intent_id IS NOT NULL
  AND refund_stripe_id IS NULL;
