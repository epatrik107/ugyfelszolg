export type PackageId = "basic" | "premium" | "premium_plus";
export type BuyerType = "individual";
export type PaymentStatus =
  | "pending"
  | "checkout_created"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "amount_mismatch"
  | "currency_mismatch"
  | "partially_refunded"
  | "refunded";
export type InvoiceStatus =
  | "not_required"
  | "pending"
  | "processing"
  | "created"
  | "failed"
  | "retry_required"
  | "already_created";
export type RefundInvoiceStatus =
  | "not_required"
  | "manual_required"
  | "created"
  | "failed";
export type AiStatus =
  | "not_started"
  | "generating"
  | "completed"
  | "failed"
  | "failed_review";
export type OrderStatusChangeSource =
  | "app"
  | "checkout"
  | "webhook"
  | "cron"
  | "ai"
  | "user"
  | "manual";

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
  PAYMENT_MODE?: "test" | "live";
  SZAMLAZZ_TEST_ACCOUNT_CONFIRMED?: string;
  /** Seller information for invoice generation */
  SELLER_NAME?: string;
  SELLER_ADDRESS?: string;
  SELLER_TAX_NUMBER?: string;
  /** szamlazz.hu agent key – presence activates production invoicing via szamlazz.hu */
  SZAMLAZZ_AGENT_KEY?: string;
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
  letter_history: string | null;
  letter_email_sent: number;
  checkout_idempotency_key: string | null;
  checkout_input_hash: string | null;
  billing_name: string | null;
  billing_email: string | null;
  billing_country: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_address_line1: string | null;
  invoice_status: InvoiceStatus;
  invoice_provider: "szamlazz" | "internal" | null;
  invoice_number: string | null;
  invoice_external_id: string | null;
  invoice_pdf_url: string | null;
  invoice_error_code: string | null;
  invoice_error_message: string | null;
  invoice_retry_count: number;
  invoice_last_attempted_at: string | null;
  invoice_next_retry_at: string | null;
  invoiced_at: string | null;
  refund_invoice_status: RefundInvoiceStatus;
  refund_amount: number | null;
  refund_stripe_id: string | null;
  letter_email_sent_versions: string | null;
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

export interface InvoiceRow {
  id: string;
  order_id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  customer_name: string;
  customer_email: string;
  issued_at: string;
  created_at: string;
  provider: "szamlazz" | "internal";
  external_id: string | null;
  pdf_url: string | null;
  updated_at: string | null;
}

export interface IndividualBillingDetails {
  buyerType: BuyerType;
  name: string;
  email: string;
  country: "HU";
  postalCode: string;
  city: string;
  addressLine1: string;
}
