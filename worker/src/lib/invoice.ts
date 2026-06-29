import {
  claimInvoiceProcessing,
  getInvoiceRetryCandidates,
  getOrderById,
  markInvoiceAttemptFailed,
  persistCreatedInvoice,
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
  | "billing_country"
  | "billing_postal_code"
  | "billing_city"
  | "billing_address_line1"
  | "server_calculated_price"
  | "currency"
  | "paid_at"
  | "selected_package"
  | "invoice_retry_count"
>;

async function sendInvoiceEmailIfConfigured(
  env: Env,
  order: InvoiceableOrder,
  invoice: InvoiceRow,
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return;
  }

  try {
    const emailResult = await sendInvoiceEmail(env, order, invoice);
    logEvent("invoice_email_sent", {
      orderId: order.id,
      invoiceNumber: invoice.invoice_number,
      providerMessageId: emailResult?.providerMessageId ?? null,
    });
  } catch (error) {
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

export function selectInvoiceProvider(env: Env): "szamlazz" | "internal" {
  return env.SZAMLAZZ_AGENT_KEY ? "szamlazz" : "internal";
}

async function allocateInternalInvoiceNumber(env: Env, issuedAt: string): Promise<string> {
  const year = getYear(issuedAt);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO invoice_sequence (year, last_number) VALUES (?, 0)",
  )
    .bind(year)
    .run();

  const [, seqRow] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE invoice_sequence SET last_number = last_number + 1 WHERE year = ?",
    ).bind(year),
    env.DB.prepare(
      "SELECT last_number FROM invoice_sequence WHERE year = ?",
    ).bind(year),
  ]);
  const lastNumber = (seqRow.results[0] as { last_number: number }).last_number;
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
  if (provider === "szamlazz") {
    const result = await issueSzamlazzInvoice(
      env,
      payload,
      order.invoice_retry_count > 1,
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
    const status = await processInvoiceForOrder(env, order.id);
    results.push({ orderId: order.id, status });
  }
  return results;
}

export async function getInvoiceByOrderId(env: Env, orderId: string) {
  return env.DB.prepare("SELECT * FROM invoices WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first<InvoiceRow>();
}
