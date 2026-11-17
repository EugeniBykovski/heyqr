import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { env } from "@/env";
import { db, schema } from "../db";
import { newId, newShortCode } from "../db/ids";
import { sendPurchaseReceipt } from "../email/send";

/** Applies one verified Stripe event. Returns false when the event was already processed. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  const inserted = await db.insert(schema.webhookEvent).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (inserted.length === 0) return false;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const { userId, qrCodeId } = s.metadata ?? {};
      if (!userId || !qrCodeId || s.payment_status !== "paid") break;
      if (s.mode === "payment") {
        const now = new Date();
        await db
          .update(schema.purchase)
          .set({ status: "paid", paidAt: now, stripePaymentIntentId: String(s.payment_intent ?? ""), amountTotal: s.amount_total ?? 0 })
          .where(eq(schema.purchase.stripeCheckoutSessionId, s.id));
        await db.update(schema.qrCode).set({ purchasedAt: now, status: "active" }).where(eq(schema.qrCode.id, qrCodeId));
        const owner = await db.query.user.findFirst({ where: eq(schema.user.id, userId) });
        if (owner)
          await sendPurchaseReceipt({
            to: owner.email,
            name: owner.name,
            qrCodeId,
            amountTotal: s.amount_total ?? 0,
            currency: s.currency ?? "usd",
          });
      } else if (s.mode === "subscription") {
        const qr = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, qrCodeId) });
        if (qr && !qr.shortCode)
          await db.update(schema.qrCode).set({ shortCode: newShortCode(), status: "active" }).where(eq(schema.qrCode.id, qrCodeId));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) break;
      const item = sub.items.data[0];
      const values = {
        userId,
        stripeSubscriptionId: sub.id,
        stripePriceId: item?.price.id ?? "",
        status: sub.status,
        activeCodeLimit: env.DYNAMIC_ACTIVE_CODE_LIMIT,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
      await db
        .insert(schema.subscription)
        .values({ id: newId(), ...values })
        .onConflictDoUpdate({ target: schema.subscription.stripeSubscriptionId, set: values });
      break;
    }
    default:
      break;
  }
  return true;
}
