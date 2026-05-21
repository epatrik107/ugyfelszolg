export type PackageId = "basic" | "premium" | "business";
export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "refunded";
export type AiStatus =
  | "not_started"
  | "generating"
  | "completed"
  | "failed"
  | "failed_review";

export interface Env {
  DB: D1Database;
  RATE_LIMIT_KV?: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  GEMINI_MODEL_PREMIUM?: string;
  GEMINI_REVIEW_MODEL?: string;
  TURNSTILE_SECRET_KEY: string;
  SITE_URL: string;
  ALLOWED_ORIGINS: string;
  TOKEN_HASH_SECRET: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  DEMO_MODE?: string;
  DEMO_ACCESS_CODE?: string;
  PAYMENTS_ENABLED?: string;
}

export interface OrderRow {
  id: string;
  public_id: string;
  result_token_hash: string;
  email: string;
  name: string;
  letter_type: string;
  recipient: string;
  problem_description: string;
  desired_result: string;
  tone: string;
  previous_messages: string | null;
  attached_letter: string | null;
  selected_package: PackageId;
  server_calculated_price: number;
  currency: string;
  payment_status: PaymentStatus;
  ai_status: AiStatus;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  generated_letter: string | null;
  generation_count: number;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  generated_at: string | null;
  error_message: string | null;
  subscription_id: string | null;
  billing_source: "checkout" | "subscription";
}

export interface SubscriptionRow {
  id: string;
  email: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  package_id: PackageId;
  quota_per_period: number;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
}

export interface UsageRow {
  id: string;
  subscription_id: string;
  period_start: string;
  period_end: string;
  quota: number;
  used_count: number;
  reserved_count: number;
  created_at: string;
  updated_at: string;
}
