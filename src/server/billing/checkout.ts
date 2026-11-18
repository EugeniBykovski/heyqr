import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "@/env";
import { paymentsConfig } from "@/server/config";
import { db, schema } from "../db";
import { newId } from "../db/ids";
import { stripe } from "./stripe";

async function customerFor(user: { id: string; email: string; name: string; stripeCustomerId?: string | null }) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
  await db.update(schema.user).set({ stripeCustomerId: customer.id }).where(eq(schema.user.id, user.id));
  return customer.id;
}

function checkoutUrl(session: { url: string | null }): string {
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
  return session.url;
}

type CheckoutInput = {
  user: { id: string; email: string; name: string; stripeCustomerId?: string | null };
  qrCodeId: string;
  layoutId: string;
  format: "png" | "svg" | "pdf";
  locale: string;
};

/**
 * Creates a Stripe Checkout session. Static codes: one-time payment. Dynamic codes: the monthly plan.
 * success/cancel URLs return to the same export screen with the same layout and format.
 */
export async function createCheckout({ user, qrCodeId, layoutId, format, locale }: CheckoutInput): Promise<string> {
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, user.id), isNull(schema.qrCode.deletedAt)),
  });
  if (!qr) throw new Error("QR code not found");

  const back = `${env.NEXT_PUBLIC_APP_URL}/${locale}/create/export?layout=${layoutId}&format=${format}`;
  const customer = await customerFor(user);
  const metadata = { userId: user.id, qrCodeId, layoutId, format };

  if (qr.model === "dynamic") {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: paymentsConfig().STRIPE_PRICE_DYNAMIC_MONTHLY, quantity: 1 }],
      success_url: `${back}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}&checkout=cancelled`,
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      customer_update: { address: "auto" },
    });
    return checkoutUrl(session);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{ price: paymentsConfig().STRIPE_PRICE_STATIC, quantity: 1 }],
    success_url: `${back}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}&checkout=cancelled`,
    metadata,
    payment_intent_data: { metadata },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
    customer_update: { address: "auto" },
  });
  await db.insert(schema.purchase).values({
    id: newId(),
    userId: user.id,
    qrCodeId,
    stripeCheckoutSessionId: session.id,
    amountTotal: session.amount_total ?? 0,
    currency: session.currency ?? env.NEXT_PUBLIC_PRICE_CURRENCY.toLowerCase(),
  });
  return checkoutUrl(session);
}

/** Stripe customer portal for plan changes, cancellation and receipts. */
export async function createPortalSession(stripeCustomerId: string, locale: string) {
  const portal = await stripe().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/${locale}/dashboard/billing`,
  });
  return portal.url;
}
