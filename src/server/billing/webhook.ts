import "server-only";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { isPlanId } from "@/shared/config/catalog";
import { db, schema } from "../db";
import { newId, newShortCode } from "../db/ids";
import { sendPurchaseReceipt } from "../email/send";
import { dynamicLimit, grantPackCredits } from "./allowances";
import { planForPrice } from "./catalog";

/** Applies one verified Stripe event. Returns false when the event was already processed. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  const inserted = await db.insert(schema.webhookEvent).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (inserted.length === 0) return false;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const { userId, qrCodeId, kind, pack, printPack } = s.metadata ?? {};
      if (!userId || s.payment_status !== "paid") break;
      const now = new Date();
      const paid = async () => {
        const [row] = await db
          .update(schema.purchase)
          .set({ status: "paid", paidAt: now, stripePaymentIntentId: String(s.payment_intent ?? ""), amountTotal: s.amount_total ?? 0 })
          .where(eq(schema.purchase.stripeCheckoutSessionId, s.id))
          .returning();
        return row;
      };
      const ownCode = qrCodeId ? and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId)) : undefined;
      if (s.mode === "payment" && kind === "pack" && (pack === "pack3" || pack === "pack10")) {
        // Design 4.8 Static Pack: its credits, once per purchase.
        const row = await paid();
        if (row) await grantPackCredits(db, userId, row.id, pack);
      } else if (s.mode === "payment" && kind === "print_pack" && ownCode) {
        // Design 8.x: the Print Pack of an already unlocked code; the code itself doesn't change.
        await paid();
        await db.update(schema.qrCode).set({ printPackAt: now }).where(ownCode);
      } else if (s.mode === "payment" && ownCode && qrCodeId) {
        // Single QR, with its Print Pack when it was on the order (design 7.3).
        const row = await paid();
        await db
          .update(schema.qrCode)
          .set({ purchasedAt: now, status: "active", ...(printPack === "1" ? { printPackAt: now } : {}) })
          .where(ownCode);
        const owner = await db.query.user.findFirst({ where: eq(schema.user.id, userId) });
        if (owner)
          await sendPurchaseReceipt({
            to: owner.email,
            name: owner.name,
            qrCodeId,
            amountTotal: row?.amountTotal ?? s.amount_total ?? 0,
            currency: s.currency ?? "usd",
          });
      } else if (s.mode === "subscription" && ownCode) {
        // A plan bought for a code (export or the trial's test code): the code goes live and keeps its short link.
        const qr = await db.query.qrCode.findFirst({ where: ownCode });
        if (qr)
          await db
            .update(schema.qrCode)
            // The trial's test code becomes a regular code of the plan (design 9.4: same short link, takes a live slot).
            .set({
              shortCode: qr.shortCode ?? newShortCode(),
              status: "active",
              isTrial: false,
              ...(printPack === "1" ? { printPackAt: now } : {}),
            })
            .where(ownCode);
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
      const plan = planForPrice(item?.price.id) ?? (isPlanId(sub.metadata?.plan) ? sub.metadata.plan : "starter");
      const values = {
        userId,
        stripeSubscriptionId: sub.id,
        stripePriceId: item?.price.id ?? "",
        status: sub.status,
        plan,
        activeCodeLimit: dynamicLimit(plan),
        currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
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
