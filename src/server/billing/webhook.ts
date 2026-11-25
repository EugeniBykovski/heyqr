import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "../db";
import { newShortCode } from "../db/ids";
import { sendPurchaseReceipt } from "../email/send";
import { processCheckoutEvent } from "./fulfillment";
import { reportCondition, reportFailure, type FailureReport } from "../monitoring";
import { step } from "../monitoring-step";
import type { NotFulfilled } from "./fulfillment";
import { processRefundEvent } from "./refunds";
import { stripe } from "./stripe";
import { planForPrice } from "./catalog";
import { applySubscriptionEvent } from "./subscriptions";

const ROUTE = "/api/stripe/webhook";

/**
 * HEY-175: how urgent a Checkout that Stripe reports paid but that was not granted is. Published flow (HEY-96, HEY-100,
 * HEY-133, HEY-134): a repeated delivery, an unpaid attempt and an ended subscription are expected (not reported);
 * a refunded order's late payment and full plan slots are handled, worth a look; anything else took money and granted
 * nothing.
 */
const REFUSAL: Record<NotFulfilled, FailureReport["severity"] | null> = {
  already_paid: null,
  not_paid: null,
  subscription_ended: null,
  order_closed: "low",
  slot_full: "low",
  no_order: "critical",
  owner_mismatch: "critical",
  order_mismatch: "critical",
  qr_mismatch: "critical",
  missing_amounts: "critical",
  currency_mismatch: "critical",
  subtotal_mismatch: "critical",
  total_mismatch: "critical",
  no_customer: "critical",
  unknown_customer: "critical",
  account_mismatch: "critical",
};

/** After the transaction committed, so a report never changes what was recorded or what Stripe is told. */
const refused = (event: Stripe.Event, operation: string, reason: string, severity: FailureReport["severity"]) =>
  reportCondition(reason, {
    operation,
    severity,
    route: ROUTE,
    correlationId: event.id,
    tags: { event_type: event.type, livemode: event.livemode },
  });

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
    reportFailure(error, { operation: "billing.receipt_email", severity: "low", route: ROUTE, log: false });
  }
}

/** Applies one verified Stripe event. Returns false when the event was already processed. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    // HEY-87 / HEY-97: one grant per order, however often or in whichever order Stripe delivers these events; the
    // event, the paid order and its grants commit together or not at all (then Stripe's retry applies them).
    const done = await processCheckoutEvent(db, { id: event.id, type: event.type, session: event.data.object }, newShortCode);
    if (done.duplicate) return false;
    if (done.result.granted) {
      if (done.result.receipt) await sendReceipt(done.result.receipt);
    } else if (done.result.reason && event.data.object.payment_status === "paid") {
      const severity = REFUSAL[done.result.reason];
      if (severity) refused(event, "billing.paid_not_granted", done.result.reason, severity);
    }
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
        const [pi, sessions] = await step("stripe.payment_retrieve", () =>
          Promise.all([
            stripe().paymentIntents.retrieve(paymentIntentId),
            stripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 }),
          ]),
        );
        return { sessionId: sessions.data[0]?.id ?? null, amountPaid: pi.amount_received ?? null };
      },
    );
    if (!done.duplicate && done.outcome === "review") refused(event, "billing.refund_review", done.reason, "high");
    return !done.duplicate;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    // HEY-132 / HEY-134: claimed and applied in one transaction, for the account bound to the subscription's Customer,
    // with the subscription as Stripe has it now (events can arrive out of order).
    const done = await applySubscriptionEvent(
      db,
      { id: event.id, type: event.type, subscription: event.data.object },
      { planForPrice, current: (id) => step("stripe.subscription_retrieve", () => stripe().subscriptions.retrieve(id)) },
    );
    if (!done.duplicate) {
      const { outcome } = done;
      if (!outcome.applied) refused(event, "billing.subscription_not_applied", outcome.reason, "critical");
      // LINK_AVAILABILITY 3a / 3b: Stripe's retries and the published access rules handle an unpaid renewal.
      else if (outcome.status === "past_due" || outcome.status === "unpaid")
        refused(event, "billing.renewal_unpaid", outcome.status, "low");
    }
    return !done.duplicate;
  }

  // Other event types aren't used; they are recorded once so a redelivery reports as a duplicate.
  const inserted = await db.insert(schema.webhookEvent).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  return inserted.length > 0;
}
