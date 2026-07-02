import type { Context } from "hono";
import { getOrderByPublicId } from "../lib/db";
import { constantTimeEqual } from "../lib/hash";
import {
  getInvoiceByOrderId,
  retryInvoiceEmailForOrder,
  retryInvoiceForOrder,
} from "../lib/invoice";
import { logEvent } from "../lib/logger";
import { getClientIp, isRateLimited } from "../lib/rateLimit";
import { errorJson, okJson } from "../lib/response";
import { InvoiceProviderError } from "../lib/szamlazz";
import type { Env, InvoiceRow, OrderRow } from "../lib/types";

type AdminContext = Context<{ Bindings: Env }>;

async function requireAdmin(c: AdminContext) {
  if (await isRateLimited(c.env, "admin-ip", getClientIp(c))) {
    return errorJson(c, "RATE_LIMITED", "Túl sok admin kérés. Kérjük, próbálja később.", 429);
  }

  const token = c.env.ADMIN_API_TOKEN?.trim();
  if (!token) {
    return errorJson(c, "ADMIN_NOT_CONFIGURED", "Az admin API nincs konfigurálva.", 503);
  }

  const authorization = c.req.header("Authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!supplied || !constantTimeEqual(supplied, token)) {
    return errorJson(c, "UNAUTHORIZED", "Jogosulatlan kérés.", 401);
  }

  return null;
}

function invoicePayload(order: OrderRow, invoice: InvoiceRow | null) {
  return {
    orderId: order.id,
    publicId: order.public_id,
    paymentStatus: order.payment_status,
    paidAmount: order.paid_amount,
    expectedAmount: order.server_calculated_price,
    currency: order.currency,
    customerEmail: order.customer_email,
    billing: {
      buyerType: order.billing_buyer_type,
      name: order.billing_name,
      email: order.billing_email,
      country: order.billing_country,
      postalCode: order.billing_postal_code,
      city: order.billing_city,
      addressLine1: order.billing_address_line1,
      taxNumber: order.billing_tax_number,
    },
    stripe: {
      checkoutSessionId: order.stripe_session_id,
      paymentIntentId: order.stripe_payment_intent_id,
    },
    invoice: {
      provider: order.invoice_provider,
      status: order.invoice_status,
      number: order.invoice_number,
      externalId: order.invoice_external_id,
      pdfUrl: order.invoice_pdf_url,
      szamlazzInvoiceId: order.szamlazz_invoice_id,
      szamlazzInvoiceNumber: order.szamlazz_invoice_number,
      createdAt: order.invoice_created_at ?? order.invoiced_at,
      errorCode: order.invoice_error_code,
      errorMessage: order.invoice_error_message,
      retryCount: order.invoice_retry_count,
      nextRetryAt: order.invoice_next_retry_at,
      emailStatus: order.invoice_email_status,
      sentToEmail: order.invoice_sent_to_email,
      sentAt: order.invoice_sent_at,
      emailErrorMessage: order.invoice_email_error_message,
      emailRetryCount: invoice?.email_retry_count ?? 0,
    },
    refund: {
      status: order.refund_invoice_status,
      amount: order.refund_amount,
      stripeId: order.refund_stripe_id,
    },
  };
}

async function loadOrderAndInvoice(c: AdminContext) {
  const publicId = c.req.param("publicId");
  if (!publicId) {
    return {
      response: errorJson(c, "ORDER_NOT_FOUND", "A rendelés nem található.", 404),
      order: null,
      invoice: null,
    };
  }
  const order = await getOrderByPublicId(c.env, publicId);
  if (!order) {
    return {
      response: errorJson(c, "ORDER_NOT_FOUND", "A rendelés nem található.", 404),
      order: null,
      invoice: null,
    };
  }
  const invoice = await getInvoiceByOrderId(c.env, order.id);
  return { response: null, order, invoice };
}

export async function adminInvoiceStatusRoute(c: AdminContext) {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const { response, order, invoice } = await loadOrderAndInvoice(c);
  if (response) return response;
  return okJson(c, invoicePayload(order!, invoice));
}

export async function adminRetryInvoiceRoute(c: AdminContext) {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const { response, order } = await loadOrderAndInvoice(c);
  if (response) return response;
  if (order!.payment_status !== "paid") {
    return errorJson(c, "ORDER_NOT_PAID", "Csak sikeresen fizetett rendelés számlázható.", 409);
  }

  const status = await retryInvoiceForOrder(c.env, order!.id);
  const updatedOrder = await getOrderByPublicId(c.env, order!.public_id);
  const invoice = await getInvoiceByOrderId(c.env, order!.id);
  logEvent("admin_invoice_retry", { orderId: order!.id, status });
  return okJson(c, {
    retried: status !== "created" && status !== "already_created",
    status,
    ...invoicePayload(updatedOrder ?? order!, invoice),
  });
}

export async function adminRetryInvoiceEmailRoute(c: AdminContext) {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const { response, order } = await loadOrderAndInvoice(c);
  if (response) return response;

  try {
    await retryInvoiceEmailForOrder(c.env, order!.id);
    const updatedOrder = await getOrderByPublicId(c.env, order!.public_id);
    const invoice = await getInvoiceByOrderId(c.env, order!.id);
    logEvent("admin_invoice_email_retry", { orderId: order!.id, status: invoice?.email_status ?? null });
    return okJson(c, invoicePayload(updatedOrder ?? order!, invoice));
  } catch (error) {
    const code = error instanceof InvoiceProviderError ? error.code : "INVOICE_EMAIL_RETRY_FAILED";
    const message = error instanceof Error ? error.message : "A számla email újraküldése sikertelen.";
    logEvent("admin_invoice_email_retry_failed", { orderId: order!.id, code });
    return errorJson(c, code, message, code === "EMAIL_NOT_CONFIGURED" ? 503 : 409);
  }
}
