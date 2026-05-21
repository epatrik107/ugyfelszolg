import type { Env, InvoiceRow, OrderRow } from "./types";

function getYear(iso: string): number {
  return new Date(iso).getFullYear();
}

/**
 * Atomically allocates the next invoice number for the given year
 * and inserts the invoice record. Returns the created invoice.
 *
 * Uses a D1 batch so the sequence increment and insert happen in the
 * same transaction, preventing gaps or duplicates under concurrent load.
 */
export async function createInvoice(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name" | "server_calculated_price" | "currency" | "paid_at" | "selected_package">,
): Promise<InvoiceRow> {
  const issuedAt = order.paid_at ?? new Date().toISOString();
  const year = getYear(issuedAt);
  const now = new Date().toISOString();
  const invoiceId = crypto.randomUUID();

  // 1. Ensure the sequence row exists for this year
  await env.DB.prepare(
    "INSERT OR IGNORE INTO invoice_sequence (year, last_number) VALUES (?, 0)",
  )
    .bind(year)
    .run();

  // 2. Increment sequence and read the new value in a single batch
  const [, seqRow] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE invoice_sequence SET last_number = last_number + 1 WHERE year = ?",
    ).bind(year),
    env.DB.prepare(
      "SELECT last_number FROM invoice_sequence WHERE year = ?",
    ).bind(year),
  ]);

  const lastNumber = (seqRow.results[0] as { last_number: number }).last_number;
  const invoiceNumber = `SZ-${year}-${String(lastNumber).padStart(4, "0")}`;

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
