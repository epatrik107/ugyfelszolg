-- Fulfillment recovery, transactional email outbox and operator visibility.
-- Additive except the dispute trigger refresh, so the previous Worker version
-- keeps operating during rollout and rollback.

ALTER TABLE orders ADD COLUMN generation_next_attempt_at TEXT;
ALTER TABLE orders ADD COLUMN generation_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN generation_last_error TEXT;
ALTER TABLE orders ADD COLUMN regeneration_request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_reason TEXT;
ALTER TABLE orders ADD COLUMN reconcile_checked_at TEXT;
ALTER TABLE orders ADD COLUMN storno_invoice_number TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_generation_due
  ON orders(ai_status, generation_next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_orders_reconcile
  ON orders(payment_status, reconcile_checked_at);

-- Rendered at send time from `kind` and `payload`; secrets and capability
-- tokens are never stored here.
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  order_id TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claimed_at TEXT,
  last_error TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_order ON email_outbox(order_id);

CREATE TRIGGER IF NOT EXISTS trg_email_outbox_status_insert_valid
BEFORE INSERT ON email_outbox
WHEN NEW.status NOT IN ('pending', 'sending', 'sent', 'skipped', 'dead')
BEGIN
  SELECT RAISE(ABORT, 'invalid email outbox status');
END;

CREATE TRIGGER IF NOT EXISTS trg_email_outbox_status_update_valid
BEFORE UPDATE OF status ON email_outbox
WHEN NEW.status NOT IN ('pending', 'sending', 'sent', 'skipped', 'dead')
BEGIN
  SELECT RAISE(ABORT, 'invalid email outbox status');
END;

CREATE TABLE IF NOT EXISTS payment_anomalies (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  stripe_object_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  event_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(reason, stripe_object_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_anomalies_open ON payment_anomalies(resolved_at);

-- Written by the GitHub "Operator action" workflow, executed by the Worker.
CREATE TABLE IF NOT EXISTS operator_requests (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  public_id TEXT NOT NULL,
  argument TEXT,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_requests_status ON operator_requests(status, created_at);

CREATE TRIGGER IF NOT EXISTS trg_operator_requests_status_insert_valid
BEFORE INSERT ON operator_requests
WHEN NEW.status NOT IN ('pending', 'done', 'failed')
  OR NEW.action NOT IN (
    'resend_access_link', 'retry_invoice', 'retry_invoice_email', 'mark_storno_done',
    'reconcile_refund', 'retry_refund', 'requeue_generation', 'resolve_anomalies'
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid operator request');
END;

CREATE TABLE IF NOT EXISTS ops_heartbeat (
  name TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS ai_provider_health (
  id TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);

-- Stripe added the `prevented` dispute status; rejecting it made the webhook
-- fail on every delivery.
DROP TRIGGER IF EXISTS trg_payment_disputes_status_insert_valid;
DROP TRIGGER IF EXISTS trg_payment_disputes_status_update_valid;

CREATE TRIGGER IF NOT EXISTS trg_payment_disputes_status_insert_valid
BEFORE INSERT ON payment_disputes
WHEN NEW.status NOT IN (
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid dispute status');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_disputes_status_update_valid
BEFORE UPDATE OF status ON payment_disputes
WHEN NEW.status NOT IN (
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid dispute status');
END;
