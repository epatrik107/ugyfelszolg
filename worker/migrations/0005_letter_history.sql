-- Store previous letter versions (JSON array) so customers can compare revisions.
ALTER TABLE orders ADD COLUMN letter_history TEXT;
-- Track whether the customer has explicitly sent the letter by email.
ALTER TABLE orders ADD COLUMN letter_email_sent INTEGER NOT NULL DEFAULT 0;
