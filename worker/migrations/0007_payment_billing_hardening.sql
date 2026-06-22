-- Production-safe Stripe + Szamlazz.hu hardening.
-- Every new column is nullable or has a default so older Worker versions can
-- continue to operate during a rolling deployment.

ALTER TABLE orders ADD COLUMN checkout_idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN checkout_input_hash TEXT;

ALTER TABLE orders ADD COLUMN billing_name TEXT;
ALTER TABLE orders ADD COLUMN billing_email TEXT;
ALTER TABLE orders ADD COLUMN billing_country TEXT;
ALTER TABLE orders ADD COLUMN billing_postal_code TEXT;
ALTER TABLE orders ADD COLUMN billing_city TEXT;
ALTER TABLE orders ADD COLUMN billing_address_line1 TEXT;

ALTER TABLE orders ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE orders ADD COLUMN invoice_provider TEXT;
ALTER TABLE orders ADD COLUMN invoice_number TEXT;
ALTER TABLE orders ADD COLUMN invoice_external_id TEXT;
ALTER TABLE orders ADD COLUMN invoice_pdf_url TEXT;
ALTER TABLE orders ADD COLUMN invoice_error_code TEXT;
ALTER TABLE orders ADD COLUMN invoice_error_message TEXT;
ALTER TABLE orders ADD COLUMN invoice_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN invoice_last_attempted_at TEXT;
ALTER TABLE orders ADD COLUMN invoice_next_retry_at TEXT;
ALTER TABLE orders ADD COLUMN invoiced_at TEXT;
ALTER TABLE orders ADD COLUMN refund_invoice_status TEXT NOT NULL DEFAULT 'not_required';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_idempotency_key
  ON orders(checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_retry
  ON orders(invoice_status, invoice_next_retry_at);

ALTER TABLE processed_stripe_events ADD COLUMN object_id TEXT;
ALTER TABLE processed_stripe_events ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE processed_stripe_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE processed_stripe_events ADD COLUMN last_error TEXT;
ALTER TABLE processed_stripe_events ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_processed_stripe_object
  ON processed_stripe_events(event_type, object_id);

ALTER TABLE invoices ADD COLUMN provider TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE invoices ADD COLUMN external_id TEXT;
ALTER TABLE invoices ADD COLUMN pdf_url TEXT;
ALTER TABLE invoices ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_external_id
  ON invoices(external_id)
  WHERE external_id IS NOT NULL;

-- Preserve the state of invoices already created before this migration.
UPDATE orders
SET invoice_status = 'created',
    invoice_provider = COALESCE(
      (SELECT provider FROM invoices WHERE invoices.order_id = orders.id),
      'internal'
    ),
    invoice_number = (SELECT invoice_number FROM invoices WHERE invoices.order_id = orders.id),
    invoice_external_id = (SELECT external_id FROM invoices WHERE invoices.order_id = orders.id),
    invoice_pdf_url = (SELECT pdf_url FROM invoices WHERE invoices.order_id = orders.id),
    invoiced_at = (SELECT issued_at FROM invoices WHERE invoices.order_id = orders.id)
WHERE EXISTS (SELECT 1 FROM invoices WHERE invoices.order_id = orders.id);
