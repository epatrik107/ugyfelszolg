import { issueSzamlazzInvoice } from "./szamlazz";
import type { Env, InvoiceRow, OrderRow } from "./types";

function getYear(iso: string): number {
  return new Date(iso).getFullYear();
}

/**
 * Returns which invoice provider is active for the current environment.
 * Production (when SZAMLAZZ_AGENT_KEY is set): "szamlazz"
 * Test / development (no key):                 "internal"
 */
export function selectInvoiceProvider(env: Env): "szamlazz" | "internal" {
  return env.SZAMLAZZ_AGENT_KEY ? "szamlazz" : "internal";
}

/**
 * Atomically allocates the next internal invoice number for the given year
 * and returns the formatted string. Uses a D1 batch to prevent gaps or
 * duplicates under concurrent load.
 */
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
  return `SZ-${year}-${String(lastNumber).padStart(4, "0")}`;
}

/**
 * Creates an invoice for a paid order and persists it locally.
 *
 * In production (SZAMLAZZ_AGENT_KEY present) the invoice is issued via
 * szamlazz.hu and their invoice number is stored.
 * In test / development the existing internal sequence is used, so no
 * external call is made and behaviour is identical to before.
 */
export async function createInvoice(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name" | "server_calculated_price" | "currency" | "paid_at" | "selected_package">,
): Promise<InvoiceRow> {
  const issuedAt = order.paid_at ?? new Date().toISOString();
  const now = new Date().toISOString();
  const invoiceId = crypto.randomUUID();

  const invoiceNumber =
    selectInvoiceProvider(env) === "szamlazz"
      ? await issueSzamlazzInvoice(env, order)
      : await allocateInternalInvoiceNumber(env, issuedAt);

  await env.DB.prepare(
    `INSERT INTO invoices
       (id, order_id, invoice_number, amount, currency, customer_name, customer_email, issued_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      invoiceId,
      order.id,
      invoiceNumber,
      order.server_calculated_price,
      order.currency,
      order.name,
      order.email,
      issuedAt,
      now,
    )
    .run();

  return {
    id: invoiceId,
    order_id: order.id,
    invoice_number: invoiceNumber,
    amount: order.server_calculated_price,
    currency: order.currency,
    customer_name: order.name,
    customer_email: order.email,
    issued_at: issuedAt,
    created_at: now,
  };
}

export async function getInvoiceByOrderId(
  env: Env,
  orderId: string,
): Promise<InvoiceRow | null> {
  return env.DB.prepare("SELECT * FROM invoices WHERE order_id = ? LIMIT 1")
    .bind(orderId)
    .first<InvoiceRow>();
}
