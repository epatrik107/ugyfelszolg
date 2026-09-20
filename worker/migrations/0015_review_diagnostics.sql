-- Additive and rollback-compatible. No letter text or free-form AI output.
CREATE TABLE generation_reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  generation_number INTEGER NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt IN (0, 1)),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected', 'unavailable')),
  findings_json TEXT NOT NULL,
  rule_blocker_count INTEGER NOT NULL,
  generation_model TEXT NOT NULL,
  review_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(order_id, run_id, attempt)
);
CREATE INDEX idx_generation_reviews_order ON generation_reviews(order_id, created_at);
