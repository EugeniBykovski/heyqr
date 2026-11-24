import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Stripe from "stripe";
import { isPlanId, type PlanId } from "../../shared/config/catalog-core";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import { dynamicLimit } from "./allowances";
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

    const item = state.items.data[0];
    const plan = sync.planForPrice(item?.price.id) ?? (isPlanId(state.metadata?.plan) ? state.metadata.plan : "starter");
    const values = {
      userId: account.userId,
      stripeSubscriptionId: sub.id,
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
    await tx
      .insert(schema.subscription)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: schema.subscription.stripeSubscriptionId, set: values });
    return { duplicate: false, outcome: { applied: true, userId: account.userId, status: state.status } } as const;
  });
}

function refuse(sub: SubscriptionEvent, reason: Exclude<SubscriptionOutcome, { applied: true }>["reason"]) {
  // Codes and the last characters of ids only: never metadata, emails or the payload.
  const customer = customerIdOf(sub.customer);
  console.warn(
    `[billing] subscription not applied: ${reason} sub=…${sub.id.slice(-6)} customer=${customer ? `…${customer.slice(-6)}` : "-"}`,
  );
  return { applied: false, reason } as const;
}
