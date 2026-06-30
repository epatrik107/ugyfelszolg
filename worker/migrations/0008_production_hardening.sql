-- Production readiness hardening.
-- Additive migration: indexes, refund metadata, payment status audit trail,
-- per-letter email send tracking, and status value validation triggers.

CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id
  ON orders(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent_id
  ON orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_magic_links_token_hash
  ON subscription_magic_links(token_hash);

CREATE INDEX IF NOT EXISTS idx_subscription_sessions_token_hash
  ON subscription_sessions(token_hash);

ALTER TABLE orders ADD COLUMN refund_amount INTEGER;
ALTER TABLE orders ADD COLUMN refund_stripe_id TEXT;
ALTER TABLE orders ADD COLUMN letter_email_sent_versions TEXT;

CREATE TABLE IF NOT EXISTS order_status_log (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  source TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_order_status_log_order_id_changed_at
  ON order_status_log(order_id, changed_at);

CREATE TRIGGER IF NOT EXISTS trg_orders_payment_status_insert_valid
BEFORE INSERT ON orders
WHEN NEW.payment_status NOT IN (
  'pending',
  'checkout_created',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'amount_mismatch',
  'currency_mismatch',
  'partially_refunded',
  'refunded'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid payment_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_payment_status_update_valid
BEFORE UPDATE OF payment_status ON orders
WHEN NEW.payment_status NOT IN (
  'pending',
  'checkout_created',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'amount_mismatch',
  'currency_mismatch',
  'partially_refunded',
  'refunded'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid payment_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_ai_status_insert_valid
BEFORE INSERT ON orders
WHEN NEW.ai_status NOT IN (
  'not_started',
  'generating',
  'completed',
  'failed',
  'failed_review'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_ai_status_update_valid
BEFORE UPDATE OF ai_status ON orders
WHEN NEW.ai_status NOT IN (
  'not_started',
  'generating',
  'completed',
  'failed',
  'failed_review'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_invoice_status_insert_valid
BEFORE INSERT ON orders
WHEN NEW.invoice_status NOT IN (
  'not_required',
  'pending',
  'processing',
  'created',
  'failed',
  'retry_required',
  'already_created'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid invoice_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_invoice_status_update_valid
BEFORE UPDATE OF invoice_status ON orders
WHEN NEW.invoice_status NOT IN (
  'not_required',
  'pending',
  'processing',
  'created',
  'failed',
  'retry_required',
  'already_created'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid invoice_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_refund_invoice_status_insert_valid
BEFORE INSERT ON orders
WHEN NEW.refund_invoice_status NOT IN (
  'not_required',
  'manual_required',
  'created',
  'failed'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid refund_invoice_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_refund_invoice_status_update_valid
BEFORE UPDATE OF refund_invoice_status ON orders
WHEN NEW.refund_invoice_status NOT IN (
  'not_required',
  'manual_required',
  'created',
  'failed'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid refund_invoice_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_processed_stripe_events_status_insert_valid
BEFORE INSERT ON processed_stripe_events
WHEN NEW.status NOT IN ('processing', 'completed', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid stripe event status');
END;

CREATE TRIGGER IF NOT EXISTS trg_processed_stripe_events_status_update_valid
BEFORE UPDATE OF status ON processed_stripe_events
WHEN NEW.status NOT IN ('processing', 'completed', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid stripe event status');
END;
