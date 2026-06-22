import type {
  Env,
  IndividualBillingDetails,
  InvoiceStatus,
  OrderRow,
  PackageId,
  PaymentStatus,
  SubscriptionRow,
  UsageRow,
} from "./types";

export async function insertOrder(
  env: Env,
  input: {
    id: string;
    publicId: string;
    resultTokenHash: string;
    email: string;
    name: string;
    letterType: string;
    recipient: string;
    problemDescription: string;
    desiredResult: string;
    tone: string;
    previousMessages: string;
    selectedPackage: PackageId;
    price: number;
    currency: string;
    billingSource?: "checkout" | "subscription";
    subscriptionId?: string | null;
    paymentStatus?: PaymentStatus;
    checkoutIdempotencyKey?: string | null;
    checkoutInputHash?: string | null;
    billing?: IndividualBillingDetails | null;
  },
) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO orders (
      id, public_id, result_token_hash, email, name, letter_type, recipient,
      problem_description, desired_result, tone, previous_messages, selected_package,
      server_calculated_price, currency, payment_status, ai_status, created_at,
      updated_at, subscription_id, billing_source, checkout_idempotency_key,
      checkout_input_hash, billing_name, billing_email, billing_country,
      billing_postal_code, billing_city, billing_address_line1
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.publicId,
      input.resultTokenHash,
      input.email,
      input.name,
      input.letterType,
      input.recipient,
      input.problemDescription,
      input.desiredResult,
      input.tone,
      input.previousMessages || null,
      input.selectedPackage,
      input.price,
      input.currency,
      input.paymentStatus ?? "pending",
      "not_started",
      now,
      now,
      input.subscriptionId ?? null,
      input.billingSource ?? "checkout",
      input.checkoutIdempotencyKey ?? null,
      input.checkoutInputHash ?? null,
      input.billing?.name ?? null,
      input.billing?.email.toLowerCase() ?? null,
      input.billing?.country ?? null,
      input.billing?.postalCode ?? null,
      input.billing?.city ?? null,
      input.billing?.addressLine1 ?? null,
    )
    .run();
  return result.meta.changes === 1;
}

export async function getOrderById(env: Env, orderId: string) {
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(orderId)
    .first<OrderRow>();
}

export async function getOrderByPublicId(env: Env, publicId: string) {
  return env.DB.prepare("SELECT * FROM orders WHERE public_id = ?")
    .bind(publicId)
    .first<OrderRow>();
}

export async function getOrderByCheckoutIdempotencyKey(env: Env, key: string) {
  return env.DB.prepare("SELECT * FROM orders WHERE checkout_idempotency_key = ?")
    .bind(key)
    .first<OrderRow>();
}

export async function getOrderByPaymentIntentId(env: Env, paymentIntentId: string) {
  return env.DB.prepare("SELECT * FROM orders WHERE stripe_payment_intent_id = ? LIMIT 1")
    .bind(paymentIntentId)
    .first<OrderRow>();
}

export async function attachStripeSession(
  env: Env,
  orderId: string,
  stripeSessionId: string,
) {
  const result = await env.DB.prepare(
    `UPDATE orders
     SET stripe_session_id = ?, payment_status = 'checkout_created', updated_at = ?
     WHERE id = ?
       AND payment_status IN ('pending', 'checkout_created')
       AND (stripe_session_id IS NULL OR stripe_session_id = ?)`,
  )
    .bind(stripeSessionId, new Date().toISOString(), orderId, stripeSessionId)
    .run();
  return result.meta.changes === 1;
}

export async function markOrderPaid(
  env: Env,
  orderId: string,
  input: {
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
  },
) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE orders
     SET payment_status = 'paid',
         paid_at = ?,
         stripe_session_id = ?,
         stripe_payment_intent_id = ?,
         invoice_status = CASE
           WHEN billing_source = 'checkout' THEN 'pending'
           ELSE invoice_status
         END,
         invoice_error_code = NULL,
         invoice_error_message = NULL,
         updated_at = ?
     WHERE id = ?
       AND payment_status IN ('pending', 'checkout_created', 'failed')`,
  )
    .bind(now, input.stripeSessionId, input.stripePaymentIntentId, now, orderId)
    .run();
  return result.meta.changes === 1;
}

export async function markOrderPaymentStatus(
  env: Env,
  orderId: string,
  status:
    | "failed"
    | "cancelled"
    | "expired"
    | "amount_mismatch"
    | "currency_mismatch"
    | "partially_refunded"
    | "refunded",
) {
  const allowedFrom: Record<typeof status, PaymentStatus[]> = {
    failed: ["pending", "checkout_created", "failed"],
    cancelled: ["pending", "checkout_created", "failed"],
    expired: ["pending", "checkout_created", "failed"],
    amount_mismatch: ["pending", "checkout_created", "failed"],
    currency_mismatch: ["pending", "checkout_created", "failed"],
    partially_refunded: ["paid", "partially_refunded"],
    refunded: ["paid", "partially_refunded"],
  };
  const placeholders = allowedFrom[status].map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `UPDATE orders SET payment_status = ?, updated_at = ?
     WHERE id = ? AND payment_status IN (${placeholders})`,
  )
    .bind(status, new Date().toISOString(), orderId, ...allowedFrom[status])
    .run();
  return result.meta.changes === 1;
}

export async function beginRegeneration(
  env: Env,
  orderId: string,
  maxRegenerations: number,
) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE orders
     SET ai_status = 'generating',
         generation_count = generation_count + 1,
         updated_at = ?
     WHERE id = ?
       AND payment_status = 'paid'
       AND ai_status = 'completed'
       AND generation_count > 0
       AND generation_count <= ?`,
  )
    .bind(now, orderId, maxRegenerations)
    .run();
  return result.meta.changes === 1;
}

export async function beginGeneration(env: Env, orderId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE orders
     SET ai_status = 'generating',
         generation_count = generation_count + 1,
         updated_at = ?
     WHERE id = ?
       AND payment_status = 'paid'
       AND ai_status = 'not_started'
       AND generation_count = 0`,
  )
    .bind(now, orderId)
    .run();
  return result.meta.changes === 1;
}

export async function completeGeneration(
  env: Env,
  orderId: string,
  generatedLetter: string,
  previousLetter?: string | null,
) {
  const now = new Date().toISOString();
  if (previousLetter) {
    const row = await env.DB.prepare(
      "SELECT letter_history FROM orders WHERE id = ?",
    ).bind(orderId).first<{ letter_history: string | null }>();
    const existing: string[] = row?.letter_history
      ? (JSON.parse(row.letter_history) as string[])
      : [];
    const newHistory = JSON.stringify([...existing, previousLetter]);
    await env.DB.prepare(
      `UPDATE orders
       SET ai_status = 'completed',
           generated_letter = ?,
           letter_history = ?,
           generated_at = ?,
           updated_at = ?,
           error_message = NULL
       WHERE id = ?`,
    ).bind(generatedLetter, newHistory, now, now, orderId).run();
  } else {
    await env.DB.prepare(
      `UPDATE orders
       SET ai_status = 'completed',
           generated_letter = ?,
           generated_at = ?,
           updated_at = ?,
           error_message = NULL
       WHERE id = ?`,
    ).bind(generatedLetter, now, now, orderId).run();
  }
}

export async function failGeneration(
  env: Env,
  orderId: string,
  status: "failed" | "failed_review",
  errorMessage: string,
) {
  await env.DB.prepare(
    `UPDATE orders
     SET ai_status = ?,
         error_message = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(status, errorMessage, new Date().toISOString(), orderId)
    .run();
}

export async function claimStripeEvent(
  env: Env,
  eventId: string,
  eventType: string,
  objectId = "",
) {
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_stripe_events
       (event_id, event_type, object_id, status, attempts, processed_at, updated_at)
     VALUES (?, ?, ?, 'processing', 1, ?, ?)`,
  )
    .bind(eventId, eventType, objectId || null, now, now)
    .run();
  if (inserted.meta.changes === 1) return true;

  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const retried = await env.DB.prepare(
    `UPDATE processed_stripe_events
     SET status = 'processing', attempts = attempts + 1, last_error = NULL, updated_at = ?
     WHERE event_id = ?
       AND (status = 'failed' OR (status = 'processing' AND updated_at < ?))`,
  )
    .bind(now, eventId, stale)
    .run();
  return retried.meta.changes === 1;
}

export async function completeStripeEvent(env: Env, eventId: string) {
  await env.DB.prepare(
    `UPDATE processed_stripe_events
     SET status = 'completed', processed_at = ?, updated_at = ?, last_error = NULL
     WHERE event_id = ?`,
  )
    .bind(new Date().toISOString(), new Date().toISOString(), eventId)
    .run();
}

export async function failStripeEvent(env: Env, eventId: string, errorCode: string) {
  await env.DB.prepare(
    `UPDATE processed_stripe_events
     SET status = 'failed', last_error = ?, updated_at = ?
     WHERE event_id = ?`,
  )
    .bind(errorCode.slice(0, 120), new Date().toISOString(), eventId)
    .run();
}

export async function claimInvoiceProcessing(env: Env, orderId: string) {
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `UPDATE orders
     SET invoice_status = 'processing',
         invoice_retry_count = invoice_retry_count + 1,
         invoice_last_attempted_at = ?,
         invoice_next_retry_at = NULL,
         invoice_error_code = NULL,
         invoice_error_message = NULL,
         updated_at = ?
     WHERE id = ?
       AND payment_status = 'paid'
       AND billing_source = 'checkout'
       AND invoice_retry_count < 5
       AND (
         invoice_status = 'pending'
         OR (invoice_status = 'retry_required' AND (invoice_next_retry_at IS NULL OR invoice_next_retry_at <= ?))
         OR (invoice_status = 'processing' AND invoice_last_attempted_at < ?)
       )`,
  )
    .bind(now, now, orderId, now, stale)
    .run();
  if (result.meta.changes !== 1) return null;
  return getOrderById(env, orderId);
}

export async function persistCreatedInvoice(
  env: Env,
  order: Pick<
    OrderRow,
    | "id"
    | "server_calculated_price"
    | "currency"
    | "billing_name"
    | "billing_email"
  >,
  invoice: {
    id: string;
    invoiceNumber: string;
    provider: "szamlazz" | "internal";
    externalId: string;
    pdfUrl: string | null;
    issuedAt: string;
    status: "created" | "already_created";
  },
) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO invoices
       (id, order_id, invoice_number, amount, currency, customer_name, customer_email,
        issued_at, created_at, provider, external_id, pdf_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      invoice.id,
      order.id,
      invoice.invoiceNumber,
      order.server_calculated_price,
      order.currency,
      order.billing_name,
      order.billing_email,
      invoice.issuedAt,
      now,
      invoice.provider,
      invoice.externalId,
      invoice.pdfUrl,
      now,
    ),
    env.DB.prepare(
      `UPDATE orders
       SET invoice_status = ?, invoice_provider = ?, invoice_number = ?,
           invoice_external_id = ?, invoice_pdf_url = ?, invoiced_at = ?,
           refund_invoice_status = CASE
             WHEN payment_status IN ('refunded', 'partially_refunded') THEN 'manual_required'
             ELSE refund_invoice_status
           END,
           invoice_error_code = NULL, invoice_error_message = NULL, updated_at = ?
       WHERE id = ? AND invoice_status = 'processing'`,
    ).bind(
      invoice.status,
      invoice.provider,
      invoice.invoiceNumber,
      invoice.externalId,
      invoice.pdfUrl,
      invoice.issuedAt,
      now,
      order.id,
    ),
  ]);
}

export async function markInvoiceAttemptFailed(
  env: Env,
  orderId: string,
  input: { retryable: boolean; errorCode: string; errorMessage: string; retryCount: number },
) {
  const exhausted = input.retryCount >= 5;
  const status: InvoiceStatus = input.retryable && !exhausted ? "retry_required" : "failed";
  const retryDelaysMinutes = [5, 30, 120, 720];
  const delay = retryDelaysMinutes[Math.min(Math.max(input.retryCount - 1, 0), 3)];
  const nextRetry = status === "retry_required"
    ? new Date(Date.now() + delay * 60 * 1000).toISOString()
    : null;
  await env.DB.prepare(
    `UPDATE orders
     SET invoice_status = ?, invoice_error_code = ?, invoice_error_message = ?,
         invoice_next_retry_at = ?, updated_at = ?
     WHERE id = ? AND invoice_status = 'processing'`,
  )
    .bind(
      status,
      input.errorCode.slice(0, 80),
      input.errorMessage.slice(0, 300),
      nextRetry,
      new Date().toISOString(),
      orderId,
    )
    .run();
  return status;
}

export async function getInvoiceRetryCandidates(env: Env, limit = 20) {
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT * FROM orders
     WHERE payment_status = 'paid'
       AND billing_source = 'checkout'
       AND invoice_retry_count < 5
       AND (
         (invoice_status = 'retry_required' AND (invoice_next_retry_at IS NULL OR invoice_next_retry_at <= ?))
         OR (invoice_status = 'processing' AND invoice_last_attempted_at < ?)
       )
     ORDER BY COALESCE(invoice_next_retry_at, invoice_last_attempted_at) ASC
     LIMIT ?`,
  )
    .bind(now, stale, limit)
    .all<OrderRow>();
  return result.results;
}

export async function markRefundInvoiceManualRequired(env: Env, orderId: string) {
  await env.DB.prepare(
    `UPDATE orders
     SET refund_invoice_status = CASE
       WHEN invoice_status IN ('created', 'already_created') THEN 'manual_required'
       ELSE 'not_required'
     END,
     updated_at = ?
     WHERE id = ?`,
  )
    .bind(new Date().toISOString(), orderId)
    .run();
}

export async function insertContactMessage(
  env: Env,
  input: { name: string; email: string; message: string },
) {
  await env.DB.prepare(
    "INSERT INTO contact_messages (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      input.name,
      input.email,
      input.message,
      new Date().toISOString(),
    )
    .run();
}

export async function upsertSubscription(
  env: Env,
  input: {
    id: string;
    email: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: string;
    packageId: PackageId;
    quotaPerPeriod: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO subscriptions (
      id, email, stripe_customer_id, stripe_subscription_id, status, package_id,
      quota_per_period, current_period_start, current_period_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET
      email = excluded.email,
      stripe_customer_id = excluded.stripe_customer_id,
      status = excluded.status,
      package_id = excluded.package_id,
      quota_per_period = excluded.quota_per_period,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at`,
  )
    .bind(
      input.id,
      input.email,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.status,
      input.packageId,
      input.quotaPerPeriod,
      input.currentPeriodStart,
      input.currentPeriodEnd,
      now,
      now,
    )
    .run();
}

export async function getSubscriptionByStripeId(
  env: Env,
  stripeSubscriptionId: string,
) {
  return env.DB.prepare(
    "SELECT * FROM subscriptions WHERE stripe_subscription_id = ?",
  )
    .bind(stripeSubscriptionId)
    .first<SubscriptionRow>();
}

export async function getLatestActiveSubscriptionByEmail(
  env: Env,
  email: string,
) {
  return env.DB.prepare(
    `SELECT * FROM subscriptions
     WHERE email = ?
       AND status IN ('active', 'trialing')
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(email)
    .first<SubscriptionRow>();
}

export async function insertMagicLink(
  env: Env,
  input: {
    id: string;
    subscriptionId: string;
    tokenHash: string;
    expiresAt: string;
  },
) {
  await env.DB.prepare(
    `INSERT INTO subscription_magic_links
     (id, subscription_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.subscriptionId,
      input.tokenHash,
      input.expiresAt,
      new Date().toISOString(),
    )
    .run();
}

export async function getMagicLinkByHash(env: Env, tokenHash: string) {
  return env.DB.prepare(
    "SELECT * FROM subscription_magic_links WHERE token_hash = ? LIMIT 1",
  )
    .bind(tokenHash)
    .first<{
      id: string;
      subscription_id: string;
      token_hash: string;
      expires_at: string;
      consumed_at: string | null;
    }>();
}

export async function consumeMagicLink(env: Env, id: string) {
  const result = await env.DB.prepare(
    "UPDATE subscription_magic_links SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
  )
    .bind(new Date().toISOString(), id)
    .run();
  return result.meta.changes === 1;
}

export async function insertSubscriptionSession(
  env: Env,
  input: {
    id: string;
    subscriptionId: string;
    tokenHash: string;
    expiresAt: string;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO subscription_sessions
     (id, subscription_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.subscriptionId,
      input.tokenHash,
      input.expiresAt,
      now,
      now,
    )
    .run();
}

export async function getSubscriptionSessionByHash(env: Env, tokenHash: string) {
  return env.DB.prepare(
    `SELECT ss.*, s.email, s.status, s.quota_per_period, s.current_period_start, s.current_period_end
     FROM subscription_sessions ss
     JOIN subscriptions s ON s.id = ss.subscription_id
     WHERE ss.token_hash = ?
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<
      {
        id: string;
        subscription_id: string;
        token_hash: string;
        expires_at: string;
        last_seen_at: string;
        email: string;
        status: string;
        quota_per_period: number;
        current_period_start: string;
        current_period_end: string;
      }
    >();
}

export async function touchSubscriptionSession(env: Env, id: string) {
  await env.DB.prepare(
    "UPDATE subscription_sessions SET last_seen_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), id)
    .run();
}

export async function ensureUsagePeriod(env: Env, subscription: SubscriptionRow) {
  const existing = await env.DB.prepare(
    `SELECT * FROM subscription_usage
     WHERE subscription_id = ? AND period_start = ?`,
  )
    .bind(subscription.id, subscription.current_period_start)
    .first<UsageRow>();

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const usage: UsageRow = {
    id: crypto.randomUUID(),
    subscription_id: subscription.id,
    period_start: subscription.current_period_start,
    period_end: subscription.current_period_end,
    quota: subscription.quota_per_period,
    used_count: 0,
    reserved_count: 0,
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    `INSERT INTO subscription_usage
     (id, subscription_id, period_start, period_end, quota, used_count, reserved_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      usage.id,
      usage.subscription_id,
      usage.period_start,
      usage.period_end,
      usage.quota,
      usage.used_count,
      usage.reserved_count,
      usage.created_at,
      usage.updated_at,
    )
    .run();

  return usage;
}

export function hasAvailableQuota(usage: Pick<UsageRow, "quota" | "used_count" | "reserved_count">) {
  return usage.used_count + usage.reserved_count < usage.quota;
}

export async function reserveQuota(env: Env, usage: UsageRow) {
  const result = await env.DB.prepare(
    `UPDATE subscription_usage
     SET reserved_count = reserved_count + 1,
         updated_at = ?
     WHERE id = ?
       AND used_count + reserved_count < quota`,
  )
    .bind(new Date().toISOString(), usage.id)
    .run();
  return result.meta.changes === 1;
}

export async function commitReservedQuota(env: Env, subscriptionId: string) {
  await env.DB.prepare(
    `UPDATE subscription_usage
     SET reserved_count = CASE WHEN reserved_count > 0 THEN reserved_count - 1 ELSE 0 END,
         used_count = used_count + 1,
         updated_at = ?
     WHERE id = (
       SELECT id FROM subscription_usage
       WHERE subscription_id = ?
       ORDER BY period_start DESC
       LIMIT 1
     )`,
  )
    .bind(new Date().toISOString(), subscriptionId)
    .run();
}

export async function releaseReservedQuota(env: Env, subscriptionId: string) {
  await env.DB.prepare(
    `UPDATE subscription_usage
     SET reserved_count = CASE WHEN reserved_count > 0 THEN reserved_count - 1 ELSE 0 END,
         updated_at = ?
     WHERE id = (
       SELECT id FROM subscription_usage
       WHERE subscription_id = ?
       ORDER BY period_start DESC
       LIMIT 1
     )`,
  )
    .bind(new Date().toISOString(), subscriptionId)
    .run();
}

export async function getCurrentUsage(env: Env, subscriptionId: string) {
  return env.DB.prepare(
    `SELECT * FROM subscription_usage
     WHERE subscription_id = ?
     ORDER BY period_start DESC
     LIMIT 1`,
  )
    .bind(subscriptionId)
    .first<UsageRow>();
}

export async function markLetterEmailSent(env: Env, orderId: string) {
  await env.DB.prepare(
    "UPDATE orders SET letter_email_sent = 1, updated_at = ? WHERE id = ?",
  ).bind(new Date().toISOString(), orderId).run();
}

export async function cleanupExpiredData(env: Env) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM subscription_magic_links WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM subscription_sessions WHERE expires_at < ?").bind(now),
    // Only delete orders that have no invoice — invoices require 8-year retention under
    // Hungarian accounting law (2000. évi C. törvény 169. §).
    env.DB.prepare(
      `DELETE FROM orders
       WHERE created_at < ?
         AND payment_status NOT IN ('paid', 'partially_refunded', 'refunded')
         AND id NOT IN (SELECT order_id FROM invoices)`,
    ).bind(cutoff),
  ]);
}

/**
 * Returns orders that have been stuck in 'generating' state for more than
 * `staleMinutes` minutes. These are candidates for automatic failure/refund
 * because their Worker execution context has long since expired.
 */
export async function getStuckGeneratingOrders(env: Env, staleMinutes = 15) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `SELECT * FROM orders
     WHERE ai_status = 'generating'
       AND updated_at < ?`,
  )
    .bind(cutoff)
    .all<OrderRow>();
  return result.results;
}
