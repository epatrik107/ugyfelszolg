-- Additive, rolling-deploy-safe evidence of the legal documents accepted at
-- checkout. Existing rows remain nullable because their historical document
-- version cannot be reconstructed reliably.

ALTER TABLE orders ADD COLUMN legal_accepted_at TEXT;
ALTER TABLE orders ADD COLUMN legal_terms_version TEXT;
ALTER TABLE orders ADD COLUMN privacy_policy_version TEXT;
