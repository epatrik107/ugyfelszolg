-- Stripe -> Szamlazz.hu invoice delivery hardening.
-- Additive migration: keeps rolling deploy compatibility while recording
-- paid amounts, billing buyer type/tax number, Szamlazz identifiers and
-- invoice email delivery/retry state.

ALTER TABLE orders ADD COLUMN paid_amount INTEGER;
ALTER TABLE orders ADD COLUMN customer_email TEXT;
ALTER TABLE orders ADD COLUMN billing_buyer_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE orders ADD COLUMN billing_tax_number TEXT;
ALTER TABLE orders ADD COLUMN szamlazz_invoice_id TEXT;
ALTER TABLE orders ADD COLUMN szamlazz_invoice_number TEXT;
ALTER TABLE orders ADD COLUMN invoice_sent_to_email TEXT;
ALTER TABLE orders ADD COLUMN invoice_sent_at TEXT;
ALTER TABLE orders ADD COLUMN invoice_created_at TEXT;
ALTER TABLE orders ADD COLUMN invoice_email_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE orders ADD COLUMN invoice_email_error_message TEXT;

ALTER TABLE invoices ADD COLUMN stripe_checkout_session_id TEXT;
ALTER TABLE invoices ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE invoices ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'created';
ALTER TABLE invoices ADD COLUMN sent_to_email TEXT;
ALTER TABLE invoices ADD COLUMN sent_at TEXT;
ALTER TABLE invoices ADD COLUMN email_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE invoices ADD COLUMN email_error_message TEXT;
ALTER TABLE invoices ADD COLUMN email_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN billing_tax_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order_id_unique
  ON invoices(order_id);

CREATE INDEX IF NOT EXISTS idx_invoices_stripe_checkout_session_id
  ON invoices(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_stripe_payment_intent_id
  ON invoices(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_email_retry
  ON orders(invoice_email_status, invoice_sent_at);

UPDATE orders
SET customer_email = COALESCE(customer_email, billing_email, email),
    paid_amount = CASE
      WHEN payment_status IN ('paid', 'partially_refunded', 'refunded') THEN server_calculated_price
      ELSE paid_amount
    END,
    invoice_created_at = COALESCE(invoice_created_at, invoiced_at),
    invoice_email_status = CASE
      WHEN invoice_status IN ('created', 'already_created') THEN 'pending'
      ELSE invoice_email_status
    END
WHERE customer_email IS NULL
   OR paid_amount IS NULL
   OR invoice_created_at IS NULL
   OR invoice_status IN ('created', 'already_created');

UPDATE orders
SET szamlazz_invoice_id = CASE
      WHEN invoice_provider IN ('szamlazz', 'szamlazz_hu') THEN invoice_external_id
      ELSE szamlazz_invoice_id
    END,
    szamlazz_invoice_number = CASE
      WHEN invoice_provider IN ('szamlazz', 'szamlazz_hu') THEN invoice_number
      ELSE szamlazz_invoice_number
    END;

UPDATE invoices
SET stripe_checkout_session_id = (
      SELECT stripe_session_id FROM orders WHERE orders.id = invoices.order_id
    ),
    stripe_payment_intent_id = (
      SELECT stripe_payment_intent_id FROM orders WHERE orders.id = invoices.order_id
    ),
    invoice_status = COALESCE((
      SELECT invoice_status FROM orders WHERE orders.id = invoices.order_id
    ), invoice_status),
    billing_tax_number = (
      SELECT billing_tax_number FROM orders WHERE orders.id = invoices.order_id
    );

CREATE TRIGGER IF NOT EXISTS trg_orders_invoice_email_status_insert_valid
BEFORE INSERT ON orders
WHEN NEW.invoice_email_status NOT IN ('not_required', 'pending', 'sent', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid invoice_email_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_invoice_email_status_update_valid
BEFORE UPDATE OF invoice_email_status ON orders
WHEN NEW.invoice_email_status NOT IN ('not_required', 'pending', 'sent', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid invoice_email_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_billing_buyer_type_insert_valid
BEFORE INSERT ON orders
WHEN NEW.billing_buyer_type NOT IN ('individual', 'business')
BEGIN
  SELECT RAISE(ABORT, 'invalid billing_buyer_type');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_billing_buyer_type_update_valid
BEFORE UPDATE OF billing_buyer_type ON orders
WHEN NEW.billing_buyer_type NOT IN ('individual', 'business')
BEGIN
  SELECT RAISE(ABORT, 'invalid billing_buyer_type');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_email_status_insert_valid
BEFORE INSERT ON invoices
WHEN NEW.email_status NOT IN ('not_required', 'pending', 'sent', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid invoice email_status');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_email_status_update_valid
BEFORE UPDATE OF email_status ON invoices
WHEN NEW.email_status NOT IN ('not_required', 'pending', 'sent', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid invoice email_status');
END;
