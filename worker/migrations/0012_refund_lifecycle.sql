-- Track the Stripe refund lifecycle independently from the aggregate payment state.
-- This is additive and safe to apply before deploying the corresponding Worker.

ALTER TABLE orders ADD COLUMN stripe_refund_status TEXT;
ALTER TABLE orders ADD COLUMN stripe_refund_failure_reason TEXT;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  stripe_refund_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  amount INTEGER,
  currency TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  first_event_id TEXT,
  last_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_order_id
  ON payment_refunds(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_intent
  ON payment_refunds(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_payment_refunds_status_insert_valid
BEFORE INSERT ON payment_refunds
WHEN NEW.status NOT IN (
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
  'unknown'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid refund status');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_refunds_status_update_valid
BEFORE UPDATE OF status ON payment_refunds
WHEN NEW.status NOT IN (
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
  'unknown'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid refund status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_stripe_refund_status_insert_valid
BEFORE INSERT ON orders
WHEN NEW.stripe_refund_status IS NOT NULL
 AND NEW.stripe_refund_status NOT IN (
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
  'unknown'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid order refund status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_stripe_refund_status_update_valid
BEFORE UPDATE OF stripe_refund_status ON orders
WHEN NEW.stripe_refund_status IS NOT NULL
 AND NEW.stripe_refund_status NOT IN (
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
  'unknown'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid order refund status');
END;
