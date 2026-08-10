-- Production hardening: data retention redaction marker and Stripe dispute audit.
-- Additive except trigger refresh, so the application can roll forward safely.

ALTER TABLE orders ADD COLUMN personal_data_redacted_at TEXT;

CREATE TABLE IF NOT EXISTS payment_disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  stripe_dispute_id TEXT NOT NULL UNIQUE,
  stripe_charge_id TEXT,
  stripe_payment_intent_id TEXT,
  amount INTEGER,
  currency TEXT,
  reason TEXT,
  status TEXT NOT NULL,
  outcome TEXT,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_order_id
  ON payment_disputes(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_payment_intent
  ON payment_disputes(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_orders_payment_status_insert_valid;
DROP TRIGGER IF EXISTS trg_orders_payment_status_update_valid;

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
  'refunded',
  'chargeback_open',
  'chargeback_lost',
  'chargeback_won'
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
  'refunded',
  'chargeback_open',
  'chargeback_lost',
  'chargeback_won'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid payment_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_disputes_status_insert_valid
BEFORE INSERT ON payment_disputes
WHEN NEW.status NOT IN (
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost'
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
  'lost'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid dispute status');
END;
