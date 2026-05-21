import {
  businessMagicLinkEmailHtml,
  invoiceEmailHtml,
  paymentFailedEmailHtml,
  refundEmailHtml,
} from "./emailTemplates";
import type { Env, InvoiceRow, OrderRow, SubscriptionRow } from "./types";

function getSellerInfo(env: Env) {
  return {
    sellerName: env.SELLER_NAME ?? "Ügyfélközpont",
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

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend API error (${response.status})`);
  }
}

export async function sendBusinessMagicLink(
  env: Env,
  subscription: SubscriptionRow,
  token: string,
) {
  const { sellerName, sellerAddress } = getSellerInfo(env);
  const link = `${env.SITE_URL}/ceges?magic=${token}`;
  const html = businessMagicLinkEmailHtml({ magicLink: link, sellerName, sellerAddress });

  await sendEmail(
    env,
    subscription.email,
    "Ügyfélközpont céges hozzáférés",
    html,
    `magic-${subscription.id}-${token.slice(0, 12)}`,
  );
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
    "A fizetés nem sikerült – Ügyfélközpont",
    html,
    `payment-failed-${order.id}`,
  );
}

