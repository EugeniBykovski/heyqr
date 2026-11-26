import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Stripe from "stripe";
import { isPlanId, type PlanId } from "../../shared/config/catalog-core";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import { dynamicLimit, hasPlanAccess } from "./allowances";
import { accountForCustomer, customerIdOf } from "./customer";

type Db = NodePgDatabase<typeof schema>;

/** The parts of a Stripe Subscription a lifecycle event writes (customer.subscription.created/updated/deleted). */
export type SubscriptionEvent = Pick<Stripe.Subscription, "id" | "customer" | "status" | "cancel_at_period_end" | "metadata"> &
  Partial<Pick<Stripe.Subscription, "cancel_at">> & {
    items: { data: Pick<Stripe.SubscriptionItem, "price" | "current_period_start" | "current_period_end">[] };
  };

export type SubscriptionOutcome =
  | { applied: true; userId: string; status: string }
  | { applied: false; reason: "no_customer" | "unknown_customer" | "account_mismatch" | "subscription_owner_mismatch" };

export type SubscriptionSync = {
  /** The Stripe Price's plan in the server catalog (HEY-131), or null for a Price the catalog doesn't know. */
  planForPrice: (priceId: string | undefined) => PlanId | null;
  /** The subscription as Stripe has it now (stripe.subscriptions.retrieve in the app). */
  current: (subscriptionId: string) => Promise<SubscriptionEvent>;
};

/** Subscription statuses whose events end access: once Stripe reports one of these, the subscription never resumes. */
const ENDED = new Set(["canceled", "incomplete_expired"]);

/**
 * HEY-132 / HEY-134: one subscription lifecycle event, applied once, in one transaction:
 * 1. The event id is claimed (webhook_event). A repeated or concurrent delivery of the same event finds it claimed and
 *    changes nothing. If anything below fails, the claim rolls back with it and Stripe's redelivery applies the event.
 * 2. The account is the one bound to the subscription's Stripe Customer (metadata.userId, when present, must agree);
 *    a subscription stored for another account is never moved. On a mismatch nothing is written.
 * 3. The account row, then the subscription row, are locked (the account-before-code order every activation uses), so
 *    events for one account apply one at a time, after any Checkout fulfillment holding the account.
 * 4. What is written is the subscription as Stripe has it now, not the event's copy: events can arrive in any order, and
 *    an older update delivered after a newer one (or after the cancellation) would otherwise restore a stale status,
 *    plan or slots. event.created is not used to order anything.
 * Stored: Stripe's status, the catalog's plan for the Price and that plan's live Dynamic slots, the billing period and
 * cancel-at-period-end. Access follows the existing policy (allowances.ts / entitlements.ts): active, trialing and
 * past_due count as the plan; a scheduled cancellation keeps it until Stripe ends the subscription.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same path as the webhook.
 */
export async function applySubscriptionEvent(
  db: Db,
  event: { id: string; type: string; subscription: SubscriptionEvent },
  sync: SubscriptionSync,
): Promise<{ duplicate: true } | { duplicate: false; outcome: SubscriptionOutcome }> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(schema.webhookEvent)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvent.id });
    if (!claimed) return { duplicate: true } as const;

    const sub = event.subscription;
    const account = await accountForCustomer(tx, customerIdOf(sub.customer), sub.metadata?.userId);
    if (!account.ok) return { duplicate: false, outcome: refuse(sub, account.reason) } as const;
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, account.userId)).for("update");
    const [existing] = await tx
      .select({ userId: schema.subscription.userId, status: schema.subscription.status })
      .from(schema.subscription)
      .where(eq(schema.subscription.stripeSubscriptionId, sub.id))
      .for("update");
    if (existing && existing.userId !== account.userId)
      return { duplicate: false, outcome: refuse(sub, "subscription_owner_mismatch") } as const;

    // Stripe's current state (a failure rolls everything back, so the event is retried). A subscription Stripe has
    // ended stays ended here, whatever an older event said.
    const latest = await sync.current(sub.id);
    const state = existing && ENDED.has(existing.status) && !ENDED.has(latest.status) ? { ...latest, status: existing.status } : latest;

    const values = { userId: account.userId, ...subscriptionValues(state, sync.planForPrice) };
    await tx
      .insert(schema.subscription)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: schema.subscription.stripeSubscriptionId, set: values });
    return { duplicate: false, outcome: { applied: true, userId: account.userId, status: state.status } } as const;
  });
}

/** What a subscription row stores of Stripe's subscription (the webhook and Resume write exactly this). */
export function subscriptionValues(state: SubscriptionEvent, planForPrice: SubscriptionSync["planForPrice"]) {
  const item = state.items.data[0];
  const plan = planForPrice(item?.price.id) ?? (isPlanId(state.metadata?.plan) ? state.metadata.plan : "starter");
  return {
    stripeSubscriptionId: state.id,
    stripePriceId: item?.price.id ?? "",
    status: state.status,
    plan,
    activeCodeLimit: dynamicLimit(plan),
    currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    // HEY-139: Stripe's Customer Portal schedules a cancellation with cancel_at (cancel_at_period_end stays false).
    cancelAtPeriodEnd: state.cancel_at_period_end || Boolean(state.cancel_at),
    cancelAt: state.cancel_at ? new Date(state.cancel_at * 1000) : null,
  };
}

export type ResumeResult = { ok: true; renewsAt: Date | null } | { ok: false; error: "not_scheduled" };

/**
 * HEY-185 "Keep my plan": undoes the owner's scheduled cancellation while the paid period still runs. Stripe keeps the
 * same subscription (no new Checkout, no charge now); it renews at the period end as before. Only the owner's own
 * subscription, only one with a cancellation scheduled and access left (`hasPlanAccess`): after the cutoff the plan has
 * ended and coming back is a new plan (Reactivate). The row is written from the subscription Stripe returns, so the page
 * is right at once; the webhook that follows re-reads Stripe's current state, so a late or repeated event can't
 * re-schedule the cancellation.
 */
export async function resumeScheduledCancellation(
  db: Db,
  userId: string,
  stripe: { clearCancellation: (subscriptionId: string) => Promise<SubscriptionEvent> },
  planForPrice: SubscriptionSync["planForPrice"],
  now: Date = new Date(),
): Promise<ResumeResult> {
  const subs = await db.query.subscription.findMany({ where: eq(schema.subscription.userId, userId) });
  const sub = subs.find((s) => s.cancelAtPeriodEnd && hasPlanAccess(s, now));
  if (!sub) return { ok: false, error: "not_scheduled" };
  const state = await stripe.clearCancellation(sub.stripeSubscriptionId);
  const values = subscriptionValues(state, planForPrice);
  await db
    .update(schema.subscription)
    .set(values)
    .where(and(eq(schema.subscription.stripeSubscriptionId, sub.stripeSubscriptionId), eq(schema.subscription.userId, userId)));
  return { ok: true, renewsAt: values.currentPeriodEnd };
}

function refuse(sub: SubscriptionEvent, reason: Exclude<SubscriptionOutcome, { applied: true }>["reason"]) {
  // Codes and the last characters of ids only: never metadata, emails or the payload.
  const customer = customerIdOf(sub.customer);
  console.warn(
    `[billing] subscription not applied: ${reason} sub=…${sub.id.slice(-6)} customer=${customer ? `…${customer.slice(-6)}` : "-"}`,
  );
  return { applied: false, reason } as const;
}
