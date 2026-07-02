import {
  claimInvoiceProcessing,
  getInvoiceRetryCandidates,
  getOrderById,
  markInvoiceEmailFailed,
  markInvoiceEmailSent,
  markInvoiceAttemptFailed,
  persistCreatedInvoice,
  resetInvoiceForManualRetry,
} from "./db";
import { sendInvoiceEmail } from "./email";
import { logEvent } from "./logger";
import {
  buildSzamlazzPayload,
  InvoiceProviderError,
  issueSzamlazzInvoice,
} from "./szamlazz";
import type { Env, InvoiceRow, OrderRow } from "./types";

type InvoiceableOrder = Pick<
  OrderRow,
  | "id"
  | "email"
  | "name"
  | "billing_name"
  | "billing_email"
  | "billing_buyer_type"
  | "billing_country"
  | "billing_postal_code"
  | "billing_city"
  | "billing_address_line1"
  | "billing_tax_number"
  | "server_calculated_price"
  | "currency"
  | "paid_at"
  | "selected_package"
  | "invoice_retry_count"
  | "stripe_session_id"
  | "stripe_payment_intent_id"
>;

async function sendInvoiceEmailIfConfigured(
  env: Env,
  order: InvoiceableOrder,
  invoice: InvoiceRow,
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return;
  }
  if (invoice.email_status === "sent") {
    return;
  }

  try {
    const emailResult = await sendInvoiceEmail(env, order, invoice);
    await markInvoiceEmailSent(env, order.id, {
      sentToEmail: invoice.customer_email,
    });
    logEvent("invoice_email_sent", {
      orderId: order.id,
      invoiceNumber: invoice.invoice_number,
      providerMessageId: emailResult?.providerMessageId ?? null,
    });
  } catch (error) {
    await markInvoiceEmailFailed(
      env,
      order.id,
      error instanceof Error ? error.message : "unknown",
    );
    logEvent("invoice_email_send_failed", {
      orderId: order.id,
      invoiceNumber: invoice.invoice_number,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

function getYear(iso: string): number {
  return new Date(iso).getUTCFullYear();
}

export function selectInvoiceProvider(env: Env): "szamlazz_hu" | "internal" {
  return env.SZAMLAZZ_AGENT_KEY ? "szamlazz_hu" : "internal";
}

function shouldRequestProviderEmail(env: Env, provider: "szamlazz_hu" | "internal") {
  return provider === "szamlazz_hu" && env.PAYMENT_MODE === "live";
}

async function allocateInternalInvoiceNumber(env: Env, issuedAt: string): Promise<string> {
  const year = getYear(issuedAt);
  const seqRow = await env.DB.prepare(
    `INSERT INTO invoice_sequence (year, last_number)
     VALUES (?, 1)
     ON CONFLICT(year) DO UPDATE SET last_number = last_number + 1
     RETURNING last_number`,
  )
    .bind(year)
    .first<{ last_number: number }>();

  if (!seqRow) {
    throw new InvoiceProviderError("INVOICE_SEQUENCE_FAILED", true, "A számlasorszám kiosztása sikertelen.");
  }

  const lastNumber = seqRow.last_number;
  return `TEST-${year}-${String(lastNumber).padStart(6, "0")}`;
}

/**
 * Creates one invoice after the caller has atomically claimed invoice processing.
 * The internal provider is deliberately test/development-only; production env
 * validation requires a Szamlazz.hu Agent key whenever payments are enabled.
 */
export async function createInvoice(env: Env, order: InvoiceableOrder): Promise<InvoiceRow> {
  const payload = buildSzamlazzPayload(order);
  const provider = selectInvoiceProvider(env);
  const issuedAt = new Date().toISOString();
  const externalId = order.id;

  let invoiceNumber: string;
  let pdfUrl: string | null = null;
  let alreadyExisted = false;
  const providerEmailRequested = shouldRequestProviderEmail(env, provider);
  if (provider === "szamlazz_hu") {
    const result = await issueSzamlazzInvoice(
      env,
      payload,
      order.invoice_retry_count > 1,
      providerEmailRequested,
    );
    invoiceNumber = result.invoiceNumber;
    pdfUrl = result.pdfUrl;
    alreadyExisted = result.alreadyExisted;
  } else {
    invoiceNumber = await allocateInternalInvoiceNumber(env, issuedAt);
  }

  const invoiceId = crypto.randomUUID();
  await persistCreatedInvoice(env, order, {
    id: invoiceId,
    invoiceNumber,
    provider,
    externalId,
    pdfUrl,
    issuedAt,
    status: alreadyExisted ? "already_created" : "created",
    emailStatus: providerEmailRequested ? "sent" : "pending",
    sentToEmail: providerEmailRequested ? payload.customerEmail : null,
    sentAt: providerEmailRequested ? issuedAt : null,
  });

  const now = new Date().toISOString();
  return {
    id: invoiceId,
    order_id: order.id,
    invoice_number: invoiceNumber,
    amount: order.server_calculated_price,
    currency: order.currency,
    customer_name: order.billing_name!,
    customer_email: order.billing_email!,
    issued_at: issuedAt,
    created_at: now,
    provider,
    external_id: externalId,
    pdf_url: pdfUrl,
    updated_at: now,
    stripe_checkout_session_id: order.stripe_session_id,
    stripe_payment_intent_id: order.stripe_payment_intent_id,
    invoice_status: alreadyExisted ? "already_created" : "created",
    sent_to_email: providerEmailRequested ? payload.customerEmail : null,
    sent_at: providerEmailRequested ? issuedAt : null,
    email_status: providerEmailRequested ? "sent" : "pending",
    email_error_message: null,
    email_retry_count: 0,
    billing_tax_number: order.billing_tax_number,
  };
}

export async function processInvoiceForOrder(env: Env, orderId: string) {
  const claimedOrder = await claimInvoiceProcessing(env, orderId);
  if (!claimedOrder) {
    const current = await getOrderById(env, orderId);
    return current?.invoice_status ?? "not_required";
  }

  try {
    const invoice = await createInvoice(env, claimedOrder);
    await sendInvoiceEmailIfConfigured(env, claimedOrder, invoice);
    return (await getOrderById(env, orderId))?.invoice_status ?? "created";
  } catch (error) {
    const providerError = error instanceof InvoiceProviderError
      ? error
      : new InvoiceProviderError("INVOICE_PROCESSING_ERROR", true, "A számlázás átmenetileg sikertelen.");
    return markInvoiceAttemptFailed(env, orderId, {
      retryable: providerError.retryable,
      errorCode: providerError.code,
      errorMessage: providerError.message,
      retryCount: claimedOrder.invoice_retry_count,
    });
  }
}

export async function retryDueInvoices(env: Env) {
  const orders = await getInvoiceRetryCandidates(env);
  const results: Array<{ orderId: string; status: string }> = [];
  for (const order of orders) {
    try {
      const status = await processInvoiceForOrder(env, order.id);
      results.push({ orderId: order.id, status });
    } catch (error) {
      logEvent("invoice_retry_error", {
        orderId: order.id,
        reason: error instanceof Error ? error.message : "unknown",
      });
      results.push({ orderId: order.id, status: "error" });
    }
  }
  return results;
}

export async function getInvoiceByOrderId(env: Env, orderId: string) {
  return env.DB.prepare("SELECT * FROM invoices WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first<InvoiceRow>();
}

export async function retryInvoiceForOrder(env: Env, orderId: string) {
  await resetInvoiceForManualRetry(env, orderId);
  return processInvoiceForOrder(env, orderId);
}

export async function retryInvoiceEmailForOrder(env: Env, orderId: string) {
  const order = await getOrderById(env, orderId);
  if (!order) {
    throw new InvoiceProviderError("ORDER_NOT_FOUND", false, "A rendelés nem található.");
  }
  const invoice = await getInvoiceByOrderId(env, orderId);
  if (!invoice) {
    throw new InvoiceProviderError("INVOICE_NOT_FOUND", false, "A számla még nem készült el.");
  }
  if (invoice.email_status === "sent") {
    return invoice;
  }
  if (!order.billing_email) {
    await markInvoiceEmailFailed(env, orderId, "Hiányzó számlázási email cím.");
    throw new InvoiceProviderError("MISSING_CUSTOMER_EMAIL", false, "Hiányzó számlázási email cím.");
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    await markInvoiceEmailFailed(env, orderId, "Az email küldő szolgáltatás nincs konfigurálva.");
    throw new InvoiceProviderError("EMAIL_NOT_CONFIGURED", false, "Az email küldő szolgáltatás nincs konfigurálva.");
  }
  await sendInvoiceEmailIfConfigured(env, order, {
    ...invoice,
    customer_email: order.billing_email,
  });
  return getInvoiceByOrderId(env, orderId);
}
