import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { isPlanId } from "@/shared/config/catalog";
import { db, schema } from "../db";
import { newId, newShortCode } from "../db/ids";
import { sendPurchaseReceipt } from "../email/send";
import { dynamicLimit } from "./allowances";
import { processCheckoutEvent } from "./fulfillment";
import { processRefundEvent } from "./refunds";
import { stripe } from "./stripe";
import { planForPrice } from "./catalog";

/** After the purchase committed: a failed email is logged, never undoes the purchase or fails the webhook. */
async function sendReceipt({
  userId,
  qrCodeId,
  amountTotal,
  currency,
}: {
  userId: string;
  qrCodeId: string;
  amountTotal: number;
  currency: string;
}) {
  try {
    const owner = await db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    if (owner) await sendPurchaseReceipt({ to: owner.email, name: owner.name, qrCodeId, amountTotal, currency });
  } catch (error) {
    console.error(`[billing] receipt email failed: ${error instanceof Error ? error.name : "unknown"} qr=${qrCodeId}`);
  }
}

/** Applies one verified Stripe event. Returns false when the event was already processed. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    // HEY-87 / HEY-97: one grant per order, however often or in whichever order Stripe delivers these events; the
    // event, the paid order and its grants commit together or not at all (then Stripe's retry applies them).
    const done = await processCheckoutEvent(db, { id: event.id, type: event.type, session: event.data.object }, newShortCode);
    if (done.duplicate) return false;
    if (done.result.granted && done.result.receipt) await sendReceipt(done.result.receipt);
    return true;
  }

  if (event.type === "refund.created" || event.type === "refund.updated") {
    // HEY-100: a confirmed refund, applied once with its event (only succeeded refunds change anything).
    const r = event.data.object;
    const done = await processRefundEvent(
      db,
      {
        id: event.id,
        type: event.type,
        refund: {
          id: r.id,
          status: r.status,
          amount: r.amount,
          currency: r.currency,
          payment_intent: typeof r.payment_intent === "string" ? r.payment_intent : (r.payment_intent?.id ?? null),
          metadata: r.metadata ?? null,
        },
      },
      async (paymentIntentId) => {
        // An order whose payment event hasn't been processed yet: its session and what Stripe received.
        const [pi, sessions] = await Promise.all([
          stripe().paymentIntents.retrieve(paymentIntentId),
          stripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 }),
        ]);
        return { sessionId: sessions.data[0]?.id ?? null, amountPaid: pi.amount_received ?? null };
      },
    );
    return !done.duplicate;
  }

  const inserted = await db.insert(schema.webhookEvent).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (inserted.length === 0) return false;

  switch (event.type) {
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
