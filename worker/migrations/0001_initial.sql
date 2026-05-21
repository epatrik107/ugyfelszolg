CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  result_token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  letter_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  problem_description TEXT NOT NULL,
  desired_result TEXT NOT NULL,
  tone TEXT NOT NULL,
  previous_messages TEXT,
  selected_package TEXT NOT NULL,
  server_calculated_price INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  ai_status TEXT NOT NULL,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  generated_letter TEXT,
  generation_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  generated_at TEXT,
  error_message TEXT,
  subscription_id TEXT,
  billing_source TEXT NOT NULL DEFAULT 'checkout'
);

CREATE INDEX IF NOT EXISTS idx_orders_public_id ON orders(public_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_subscription_id ON orders(subscription_id);

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  package_id TEXT NOT NULL,
  quota_per_period INTEGER NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);

CREATE TABLE IF NOT EXISTS subscription_magic_links (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX IF NOT EXISTS idx_magic_links_subscription_id ON subscription_magic_links(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_sessions (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_sessions_subscription_id ON subscription_sessions(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_usage (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  quota INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  reserved_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscription_id, period_start),
  FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_usage_subscription_id ON subscription_usage(subscription_id);
