import type {
  Env,
  BillingDetails,
  InvoiceEmailStatus,
  InvoiceStatus,
  OrderStatusChangeSource,
  OrderRow,
  PackageId,
  PaymentStatus,
  SubscriptionRow,
  UsageRow,
} from "./types";

type MutablePaymentStatus =
  | "failed"
  | "cancelled"
  | "expired"
  | "amount_mismatch"
  | "currency_mismatch"
  | "partially_refunded"
  | "refunded";

function paymentStatusLogStatement(
  env: Env,
  input: {
    orderId: string;
    toStatus: PaymentStatus;
    allowedFrom: PaymentStatus[];
    source: OrderStatusChangeSource;
    now: string;
  },
) {
  const placeholders = input.allowedFrom.map(() => "?").join(", ");
  return env.DB.prepare(
    `INSERT INTO order_status_log
       (id, order_id, from_status, to_status, source, changed_at)
     SELECT ?, id, payment_status, ?, ?, ?
     FROM orders
     WHERE id = ?
       AND payment_status IN (${placeholders})
       AND payment_status <> ?`,
  )
    .bind(
      crypto.randomUUID(),
      input.toStatus,
      input.source,
      input.now,
      input.orderId,
      ...input.allowedFrom,
      input.toStatus,
    );
}

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
    billing?: BillingDetails | null;
  },
) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO orders (
      id, public_id, result_token_hash, email, name, letter_type, recipient,
      problem_description, desired_result, tone, previous_messages, selected_package,
      server_calculated_price, currency, payment_status, ai_status, created_at,
      updated_at, subscription_id, billing_source, checkout_idempotency_key,
      checkout_input_hash, customer_email, billing_buyer_type, billing_name,
      billing_email, billing_country, billing_postal_code, billing_city,
      billing_address_line1, billing_tax_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.billing?.email.toLowerCase() ?? input.email,
      input.billing?.buyerType ?? "individual",
      input.billing?.name ?? null,
      input.billing?.email.toLowerCase() ?? null,
      input.billing?.country ?? null,
      input.billing?.postalCode ?? null,
      input.billing?.city ?? null,
      input.billing?.addressLine1 ?? null,
      input.billing?.buyerType === "business" ? input.billing.taxNumber : null,
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
  source: OrderStatusChangeSource = "checkout",
) {
  const now = new Date().toISOString();
  const [, result] = await env.DB.batch([
    paymentStatusLogStatement(env, {
      orderId,
      toStatus: "checkout_created",
      allowedFrom: ["pending", "checkout_created"],
      source,
      now,
    }),
    env.DB.prepare(
      `UPDATE orders
       SET stripe_session_id = ?, payment_status = 'checkout_created', updated_at = ?
       WHERE id = ?
         AND payment_status IN ('pending', 'checkout_created')
         AND (stripe_session_id IS NULL OR stripe_session_id = ?)`,
    ).bind(stripeSessionId, now, orderId, stripeSessionId),
  ]);
  return result.meta.changes === 1;
}

export async function markOrderPaid(
  env: Env,
  orderId: string,
  input: {
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
    paidAmount: number;
    source?: OrderStatusChangeSource;
  },
) {
  const now = new Date().toISOString();
  const [, result] = await env.DB.batch([
    paymentStatusLogStatement(env, {
      orderId,
      toStatus: "paid",
      allowedFrom: ["pending", "checkout_created", "failed"],
      source: input.source ?? "webhook",
      now,
    }),
    env.DB.prepare(
      `UPDATE orders
       SET payment_status = 'paid',
           paid_at = ?,
           stripe_session_id = ?,
           stripe_payment_intent_id = ?,
           paid_amount = ?,
           invoice_status = CASE
             WHEN billing_source = 'checkout' THEN 'pending'
             ELSE invoice_status
           END,
           invoice_error_code = NULL,
           invoice_error_message = NULL,
           updated_at = ?
       WHERE id = ?
         AND payment_status IN ('pending', 'checkout_created', 'failed')`,
    ).bind(now, input.stripeSessionId, input.stripePaymentIntentId, input.paidAmount, now, orderId),
  ]);
  return result.meta.changes === 1;
}

export async function markOrderPaymentStatus(
  env: Env,
  orderId: string,
  status: MutablePaymentStatus,
  options: {
    source?: OrderStatusChangeSource;
    refundAmount?: number | null;
    refundStripeId?: string | null;
  } = {},
) {
  const allowedFrom: Record<MutablePaymentStatus, PaymentStatus[]> = {
    failed: ["pending", "checkout_created", "failed"],
    cancelled: ["pending", "checkout_created", "failed"],
    expired: ["pending", "checkout_created", "failed"],
    amount_mismatch: ["pending", "checkout_created", "failed"],
    currency_mismatch: ["pending", "checkout_created", "failed"],
    partially_refunded: ["paid", "partially_refunded"],
    refunded: ["paid", "partially_refunded"],
  };
  const fromStatuses = allowedFrom[status];
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const refundStatus = status === "partially_refunded" || status === "refunded";
  const refundColumns = refundStatus
    ? `, refund_amount = COALESCE(?, refund_amount),
         refund_stripe_id = COALESCE(?, refund_stripe_id),
         refund_invoice_status = CASE
           WHEN invoice_status IN ('created', 'already_created') THEN 'manual_required'
           ELSE refund_invoice_status
         END`
    : "";
  const updateBindings: unknown[] = [status, now];
  if (refundStatus) {
    updateBindings.push(options.refundAmount ?? null, options.refundStripeId ?? null);
  }
  updateBindings.push(orderId, ...fromStatuses);

  const [, result] = await env.DB.batch([
    paymentStatusLogStatement(env, {
      orderId,
      toStatus: status,
      allowedFrom: fromStatuses,
      source: options.source ?? "app",
      now,
    }),
    env.DB.prepare(
      `UPDATE orders SET payment_status = ?, updated_at = ?${refundColumns}
       WHERE id = ? AND payment_status IN (${placeholders})`,
    ).bind(...updateBindings),
  ]);
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
         letter_email_sent = 0,
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
  let result: D1Result;
  if (previousLetter) {
    result = await env.DB.prepare(
      `UPDATE orders
       SET ai_status = 'completed',
           generated_letter = ?,
           letter_history = json_insert(
             CASE
               WHEN letter_history IS NULL THEN '[]'
               WHEN json_valid(letter_history) THEN letter_history
               ELSE '[]'
             END,
             '$[#]',
             ?
           ),
           generated_at = ?,
           updated_at = ?,
           error_message = NULL
       WHERE id = ?
         AND ai_status = 'generating'
         AND payment_status IN ('paid', 'partially_refunded')`,
    ).bind(generatedLetter, previousLetter, now, now, orderId).run();
  } else {
    result = await env.DB.prepare(
      `UPDATE orders
       SET ai_status = 'completed',
           generated_letter = ?,
           generated_at = ?,
           updated_at = ?,
           error_message = NULL
       WHERE id = ?
         AND ai_status = 'generating'
         AND payment_status IN ('paid', 'partially_refunded')`,
    ).bind(generatedLetter, now, now, orderId).run();
  }
  return result.meta.changes === 1;
}

export async function failGeneration(
  env: Env,
  orderId: string,
  status: "failed" | "failed_review",
  errorMessage: string,
  subscriptionId?: string | null,
) {
  const now = new Date().toISOString();
  const failStatement = env.DB.prepare(
    `UPDATE orders
     SET ai_status = ?,
         error_message = ?,
         updated_at = ?
     WHERE id = ?
       AND ai_status IN ('generating', 'not_started')
       AND payment_status IN ('paid', 'partially_refunded')`,
  )
    .bind(status, errorMessage, now, orderId);

  const result = await failStatement.run();
  if (result.meta.changes !== 1) return false;

  if (subscriptionId) {
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
    ).bind(now, subscriptionId).run();
  }

  return true;
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

export async function getProcessedStripeEventStatus(env: Env, eventId: string) {
  const row = await env.DB.prepare(
    "SELECT status FROM processed_stripe_events WHERE event_id = ? LIMIT 1",
  )
    .bind(eventId)
    .first<{ status: "processing" | "completed" | "failed" }>();
  return row?.status ?? null;
}

export async function completeStripeEvent(env: Env, eventId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE processed_stripe_events
     SET status = 'completed', processed_at = ?, updated_at = ?, last_error = NULL
     WHERE event_id = ? AND status = 'processing'`,
  )
    .bind(now, now, eventId)
    .run();
  return result.meta.changes === 1;
}

export async function failStripeEvent(env: Env, eventId: string, errorCode: string) {
  const result = await env.DB.prepare(
    `UPDATE processed_stripe_events
     SET status = 'failed', last_error = ?, updated_at = ?
     WHERE event_id = ? AND status = 'processing'`,
  )
    .bind(errorCode.slice(0, 120), new Date().toISOString(), eventId)
    .run();
  return result.meta.changes === 1;
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
    | "billing_tax_number"
    | "stripe_session_id"
    | "stripe_payment_intent_id"
  >,
  invoice: {
    id: string;
    invoiceNumber: string;
    provider: "szamlazz_hu" | "internal";
    externalId: string;
    pdfUrl: string | null;
    issuedAt: string;
    status: "created" | "already_created";
    emailStatus: InvoiceEmailStatus;
    sentToEmail: string | null;
    sentAt: string | null;
  },
) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO invoices
       (id, order_id, invoice_number, amount, currency, customer_name, customer_email,
        issued_at, created_at, provider, external_id, pdf_url, updated_at,
        stripe_checkout_session_id, stripe_payment_intent_id, invoice_status,
        sent_to_email, sent_at, email_status, email_error_message, email_retry_count,
        billing_tax_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      order.stripe_session_id,
      order.stripe_payment_intent_id,
      invoice.status,
      invoice.sentToEmail,
      invoice.sentAt,
      invoice.emailStatus,
      null,
      0,
      order.billing_tax_number,
    ),
    env.DB.prepare(
      `UPDATE orders
       SET invoice_status = ?, invoice_provider = ?, invoice_number = ?,
           invoice_external_id = ?, invoice_pdf_url = ?, invoiced_at = ?,
           szamlazz_invoice_id = CASE
             WHEN ? = 'szamlazz_hu' THEN ?
             ELSE szamlazz_invoice_id
           END,
           szamlazz_invoice_number = CASE
             WHEN ? = 'szamlazz_hu' THEN ?
             ELSE szamlazz_invoice_number
           END,
           invoice_created_at = COALESCE(invoice_created_at, ?),
           invoice_sent_to_email = ?,
           invoice_sent_at = ?,
           invoice_email_status = ?,
           invoice_email_error_message = NULL,
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
      invoice.provider,
      invoice.externalId,
      invoice.provider,
      invoice.invoiceNumber,
      now,
      invoice.sentToEmail,
      invoice.sentAt,
      invoice.emailStatus,
      now,
      order.id,
    ),
  ]);
}

export async function markInvoiceEmailSent(
  env: Env,
  orderId: string,
  input: { sentToEmail: string; sentAt?: string },
) {
  const sentAt = input.sentAt ?? new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE orders
       SET invoice_email_status = 'sent',
           invoice_sent_to_email = ?,
           invoice_sent_at = ?,
           invoice_email_error_message = NULL,
           updated_at = ?
       WHERE id = ?`,
    ).bind(input.sentToEmail, sentAt, sentAt, orderId),
    env.DB.prepare(
      `UPDATE invoices
       SET email_status = 'sent',
           sent_to_email = ?,
           sent_at = ?,
           email_error_message = NULL,
           updated_at = ?
       WHERE order_id = ?`,
    ).bind(input.sentToEmail, sentAt, sentAt, orderId),
  ]);
}

export async function markInvoiceEmailFailed(
  env: Env,
  orderId: string,
  errorMessage: string,
) {
  const now = new Date().toISOString();
  const message = errorMessage.slice(0, 300);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE orders
       SET invoice_email_status = 'failed',
           invoice_email_error_message = ?,
           updated_at = ?
       WHERE id = ?`,
    ).bind(message, now, orderId),
    env.DB.prepare(
      `UPDATE invoices
       SET email_status = 'failed',
           email_error_message = ?,
           email_retry_count = email_retry_count + 1,
           updated_at = ?
       WHERE order_id = ?`,
    ).bind(message, now, orderId),
  ]);
}

export async function resetInvoiceForManualRetry(env: Env, orderId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE orders
     SET invoice_status = 'pending',
         invoice_error_code = NULL,
         invoice_error_message = NULL,
         invoice_next_retry_at = NULL,
         updated_at = ?
     WHERE id = ?
       AND payment_status = 'paid'
       AND billing_source = 'checkout'
       AND invoice_status IN ('failed', 'retry_required')`,
  )
    .bind(now, orderId)
    .run();
  return result.meta.changes === 1;
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
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO subscription_usage
     (id, subscription_id, period_start, period_end, quota, used_count, reserved_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      subscription.id,
      subscription.current_period_start,
      subscription.current_period_end,
      subscription.quota_per_period,
      0,
      0,
      now,
      now,
    )
    .run();

  const usage = await env.DB.prepare(
    `SELECT * FROM subscription_usage
     WHERE subscription_id = ? AND period_start = ?`,
  )
    .bind(subscription.id, subscription.current_period_start)
    .first<UsageRow>();

  if (!usage) {
    throw new Error("USAGE_PERIOD_NOT_FOUND");
  }
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

export async function getLetterEmailVersionKey(letter: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(letter),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

export function hasLetterEmailVersionSent(
  order: Pick<OrderRow, "letter_email_sent" | "letter_email_sent_versions">,
  versionKey: string,
) {
  if (!order.letter_email_sent_versions) return order.letter_email_sent === 1;
  try {
    const versions = JSON.parse(order.letter_email_sent_versions) as unknown;
    return Array.isArray(versions) && versions.includes(versionKey);
  } catch {
    return order.letter_email_sent === 1;
  }
}

export async function markLetterEmailSent(
  env: Env,
  orderId: string,
  versionKey = "current",
) {
  await env.DB.prepare(
    `UPDATE orders
     SET letter_email_sent = 1,
         letter_email_sent_versions = CASE
           WHEN letter_email_sent_versions IS NULL THEN json_array(?)
           WHEN NOT json_valid(letter_email_sent_versions) THEN json_array(?)
           WHEN EXISTS (
             SELECT 1 FROM json_each(letter_email_sent_versions)
             WHERE value = ?
           ) THEN letter_email_sent_versions
           ELSE json_insert(letter_email_sent_versions, '$[#]', ?)
         END,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      versionKey,
      versionKey,
      versionKey,
      versionKey,
      new Date().toISOString(),
      orderId,
    )
    .run();
}

export async function cleanupExpiredData(env: Env) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const eventCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM subscription_magic_links WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM subscription_sessions WHERE expires_at < ?").bind(now),
    // Completed Stripe events older than 30 days — failed/processing events are
    // kept for manual investigation.
    env.DB.prepare(
      "DELETE FROM processed_stripe_events WHERE status = 'completed' AND processed_at < ?",
    ).bind(eventCutoff),
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
       AND payment_status IN ('paid', 'partially_refunded')
       AND updated_at < ?`,
  )
    .bind(cutoff)
    .all<OrderRow>();
  return result.results;
}
