import {
  checkoutExpiredEmailHtml,
  invoiceEmailHtml,
  letterReadyEmailHtml,
  paymentFailedEmailHtml,
  refundEmailHtml,
} from "./emailTemplates";
import type { Env, InvoiceRow, OrderRow } from "./types";

function getSellerInfo(env: Env) {
  return {
    sellerName: env.SELLER_NAME ?? "Ügyfélszolgálat",
    sellerAddress: env.SELLER_ADDRESS ?? "",
    sellerTaxNumber: env.SELLER_TAX_NUMBER ?? "",
  };
}

async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  idempotencyKey?: string,
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Email service is not configured.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const body = JSON.stringify({
    from: env.EMAIL_FROM,
    to: [to],
    subject,
    html,
  });

  // Retry once after 1.5s on transient 5xx errors
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body,
    });

    if (response.ok) return;

    const isTransient = response.status >= 500;
    if (!isTransient || attempt === 1) {
      // Capture the response body for better debugging
      const responseBody = await response.text().catch(() => "");
      throw new Error(`Resend API error (${response.status}): ${responseBody.slice(0, 300)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function sendInvoiceEmail(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name" | "server_calculated_price" | "currency" | "paid_at" | "selected_package">,
  invoice: InvoiceRow,
) {
  const { sellerName, sellerAddress, sellerTaxNumber } = getSellerInfo(env);
  const { PACKAGES } = await import("./packages");
  const serviceName = PACKAGES[order.selected_package]?.name ?? "Levélírási szolgáltatás";

  const html = invoiceEmailHtml({
    invoiceNumber: invoice.invoice_number,
    issuedAt: invoice.issued_at,
    customerName: order.name,
    customerEmail: order.email,
    serviceName,
    amount: invoice.amount,
    currency: invoice.currency,
    sellerName,
    sellerAddress,
    sellerTaxNumber,
  });

  await sendEmail(
    env,
    order.email,
    `Számla – ${invoice.invoice_number}`,
    html,
    `invoice-${invoice.id}`,
  );
}

export async function sendRefundEmail(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name" | "server_calculated_price" | "currency">,
  invoiceNumber: string | null,
  reason: string,
) {
  const { sellerName, sellerAddress } = getSellerInfo(env);
  const html = refundEmailHtml({
    customerName: order.name,
    invoiceNumber,
    amount: order.server_calculated_price,
    currency: order.currency,
    reason,
    siteUrl: env.SITE_URL,
    sellerName,
    sellerAddress,
  });

  await sendEmail(
    env,
    order.email,
    "Visszatérítési értesítő",
    html,
    `refund-${order.id}`,
  );
}

export async function sendPaymentFailedEmail(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name" | "server_calculated_price" | "currency">,
) {
  const { sellerName, sellerAddress } = getSellerInfo(env);
  const html = paymentFailedEmailHtml({
    customerName: order.name,
    amount: order.server_calculated_price,
    currency: order.currency,
    siteUrl: env.SITE_URL,
    sellerName,
    sellerAddress,
  });

  await sendEmail(
    env,
    order.email,
    "A fizetés nem sikerült – Ügyfélszolgálat",
    html,
    `payment-failed-${order.id}`,
  );
}

export async function sendCheckoutExpiredEmail(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name">,
) {
  const { sellerName, sellerAddress } = getSellerInfo(env);
  const html = checkoutExpiredEmailHtml({
    customerName: order.name,
    siteUrl: env.SITE_URL,
    sellerName,
    sellerAddress,
  });

  await sendEmail(
    env,
    order.email,
    "A fizetési munkamenet lejárt – Ügyfélszolgálat",
    html,
    `expired-${order.id}`,
  );
}

export async function sendLetterReadyEmail(
  env: Env,
  order: Pick<OrderRow, "id" | "email" | "name" | "public_id" | "generation_count">,
  letter: string,
  resultToken: string,
  idempotencyKeySuffix?: string,
) {
  const { sellerName, sellerAddress } = getSellerInfo(env);
  const orderUrl = `${env.SITE_URL}/sikeres-fizetes?order=${order.public_id}&token=${resultToken}`;
  const generationCount = order.generation_count ?? 1;
  const html = letterReadyEmailHtml({
    customerName: order.name,
    letter,
    orderUrl,
    sellerName,
    sellerAddress,
  });

  const idempotencyKey = idempotencyKeySuffix
    ? `letter-ready-${order.id}-${idempotencyKeySuffix}`
    : `letter-ready-${order.id}-g${generationCount}`;

  await sendEmail(
    env,
    order.email,
    "Elkészült a levele – Ügyfélszolgálat",
    html,
    idempotencyKey,
  );
}
