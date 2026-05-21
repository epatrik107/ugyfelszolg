import type { Context } from "hono";
import {
  beginGeneration,
  claimStripeEvent,
  ensureUsagePeriod,
  getOrderById,
  markOrderPaid,
  markOrderPaymentStatus,
  reserveQuota,
  upsertSubscription,
} from "../lib/db";
import { sendBusinessMagicLink } from "../lib/email";
import { generateOpaqueToken, hashToken } from "../lib/hash";
import { logEvent } from "../lib/logger";
import { generateLetterForPaidOrder } from "../lib/openai";
import { canStartGeneration } from "../lib/orderState";
import { PACKAGES, getPackage } from "../lib/packages";
import {
  retrieveCheckoutSession,
  retrieveSubscription,
  verifyStripeWebhook,
  type StripeEvent,
} from "../lib/stripe";
import type { Env } from "../lib/types";

const MAGIC_LINK_EXPIRY_MS = 30 * 60 * 1000;

async function createMagicLinkForSubscription(
  c: Context<{ Bindings: Env }>,
  subscriptionId: string,
) {
  const subscription = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE id = ?",
  )
    .bind(subscriptionId)
    .first<{
      id: string;
      email: string;
      stripe_customer_id: string;
      stripe_subscription_id: string;
      status: string;
      package_id: "business";
      quota_per_period: number;
      current_period_start: string;
      current_period_end: string;
      created_at: string;
      updated_at: string;
    }>();

  if (!subscription) {
    return;
  }

  const token = generateOpaqueToken();
  await c.env.DB.prepare(
    `INSERT INTO subscription_magic_links
     (id, subscription_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      subscription.id,
      await hashToken(token, c.env.TOKEN_HASH_SECRET),
      new Date(Date.now() + MAGIC_LINK_EXPIRY_MS).toISOString(),
      new Date().toISOString(),
    )
    .run();
  await sendBusinessMagicLink(c.env, subscription, token);
}

async function handleCheckoutCompleted(
  c: Context<{ Bindings: Env }>,
  sessionId: string,
) {
  const session = await retrieveCheckoutSession(c.env, sessionId);
  const orderId = session.metadata.orderId;
  const packageId = session.metadata.selectedPackage as
    | "basic"
    | "premium"
    | "business"
    | undefined;
  if (!orderId || !packageId) {
    return;
  }

  const order = await getOrderById(c.env, orderId);
  if (!order || order.payment_status !== "pending") {
    return;
  }

  const selectedPackage = getPackage(packageId);
  if (
    session.payment_status !== "paid" ||
    session.amount_total !== selectedPackage.price ||
    session.currency !== selectedPackage.currency
  ) {
    return;
  }

  if (packageId === "business") {
    if (!session.subscription || !session.customer) {
      return;
    }
    const stripeSubscription = await retrieveSubscription(
      c.env,
      session.subscription,
    );
    const subscriptionId = crypto.randomUUID();
    await upsertSubscription(c.env, {
      id: subscriptionId,
      email: order.email,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      packageId: "business",
      quotaPerPeriod: PACKAGES.business.quotaPerPeriod,
      currentPeriodStart: new Date(
        stripeSubscription.current_period_start * 1000,
      ).toISOString(),
      currentPeriodEnd: new Date(
        stripeSubscription.current_period_end * 1000,
      ).toISOString(),
    });
    const subscription = await c.env.DB.prepare(
      "SELECT * FROM subscriptions WHERE stripe_subscription_id = ?",
    )
      .bind(stripeSubscription.id)
      .first<{
        id: string;
        email: string;
        stripe_customer_id: string;
        stripe_subscription_id: string;
        status: string;
        package_id: "business";
        quota_per_period: number;
        current_period_start: string;
        current_period_end: string;
        created_at: string;
        updated_at: string;
      }>();
    if (!subscription) {
      return;
    }
    const usage = await ensureUsagePeriod(c.env, subscription);
    await reserveQuota(c.env, usage);
    await c.env.DB.prepare(
      "UPDATE orders SET subscription_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(subscriptionId, new Date().toISOString(), order.id)
      .run();
    await createMagicLinkForSubscription(c, subscriptionId);
  }

  await markOrderPaid(c.env, order.id, {
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent,
  });
  logEvent("payment_paid", { orderId: order.id, stripeSessionId: session.id });

  const paidOrder = await getOrderById(c.env, order.id);
  if (paidOrder && canStartGeneration(paidOrder) && (await beginGeneration(c.env, paidOrder.id))) {
    c.executionCtx.waitUntil(generateLetterForPaidOrder(c.env, paidOrder));
  }
}

async function handleSubscriptionEvent(
  c: Context<{ Bindings: Env }>,
  event: StripeEvent<{ id: string; customer: string; status: string; current_period_start: number; current_period_end: number }>,
) {
  const subscription = event.data.object;
  const existing = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1",
  )
    .bind(subscription.id)
    .first<{
      id: string;
      email: string;
      stripe_customer_id: string;
      stripe_subscription_id: string;
      status: string;
      package_id: "business";
      quota_per_period: number;
      current_period_start: string;
      current_period_end: string;
      created_at: string;
      updated_at: string;
    }>();
  if (!existing) {
    return;
  }

  await upsertSubscription(c.env, {
    id: existing.id,
    email: existing.email,
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    packageId: "business",
    quotaPerPeriod: PACKAGES.business.quotaPerPeriod,
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
  });
}

async function handleInvoicePaid(
  c: Context<{ Bindings: Env }>,
  invoice: { subscription: string | null },
) {
  if (!invoice.subscription) {
    return;
  }
  const subscription = await retrieveSubscription(c.env, invoice.subscription);
  await handleSubscriptionEvent(c, {
    id: `invoice-paid-${subscription.id}`,
    type: "customer.subscription.updated",
    data: { object: subscription },
  });
}

async function handleInvoicePaymentFailed(
  c: Context<{ Bindings: Env }>,
  invoice: { subscription: string | null },
) {
  if (!invoice.subscription) {
    return;
  }
  const subscription = await retrieveSubscription(c.env, invoice.subscription);
  await handleSubscriptionEvent(c, {
    id: `invoice-failed-${subscription.id}`,
    type: "customer.subscription.updated",
    data: { object: subscription },
  });
}

export async function stripeWebhookRoute(c: Context<{ Bindings: Env }>) {
  if (c.env.PAYMENTS_ENABLED !== "true") {
    return c.text("Payments disabled", 404);
  }

  const rawBody = await c.req.text();
  const event = await verifyStripeWebhook(
    rawBody,
    c.req.header("Stripe-Signature"),
    c.env.STRIPE_WEBHOOK_SECRET,
  );

  if (!event) {
    logEvent("stripe_webhook_signature_failed");
    return c.text("Invalid signature", 400);
  }

  logEvent("stripe_webhook_signature_verified", { eventId: event.id });
  logEvent("stripe_webhook_received", { eventId: event.id, eventType: event.type });
  const firstTime = await claimStripeEvent(c.env, event.id, event.type);
  if (!firstTime) {
    return c.text("Already processed", 200);
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(c, (event.data.object as { id: string }).id);
      break;
    case "checkout.session.expired": {
      const object = event.data.object as { metadata?: Record<string, string> };
      if (object.metadata?.orderId) {
        await markOrderPaymentStatus(c.env, object.metadata.orderId, "expired");
      }
      break;
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as { metadata?: Record<string, string> };
      if (paymentIntent.metadata?.orderId) {
        await markOrderPaymentStatus(c.env, paymentIntent.metadata.orderId, "failed");
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as { metadata?: Record<string, string> };
      if (charge.metadata?.orderId) {
        await markOrderPaymentStatus(c.env, charge.metadata.orderId, "refunded");
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionEvent(c, event as never);
      break;
    case "invoice.paid":
      await handleInvoicePaid(
        c,
        event.data.object as { subscription: string | null },
      );
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(
        c,
        event.data.object as { subscription: string | null },
      );
      break;
    default:
      break;
  }

  return c.text("ok", 200);
}
