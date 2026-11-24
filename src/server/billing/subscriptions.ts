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
export type SubscriptionEvent = Pick<Stripe.Subscription, "id" | "customer" | "status" | "cancel_at_period_end" | "metadata"> & {
  items: { data: Pick<Stripe.SubscriptionItem, "price" | "current_period_start" | "current_period_end">[] };
};

export type SubscriptionOutcome =
  | { applied: true; userId: string }
  | { applied: false; reason: "no_customer" | "unknown_customer" | "account_mismatch" | "subscription_owner_mismatch" };

/**
 * HEY-132: one subscription lifecycle event, written for the account that holds the subscription's Stripe Customer
 * (user.stripe_customer_id). metadata.userId, when present, must name that same account. A subscription already stored
 * for another account is never moved. On any mismatch nothing is written, so no plan or Dynamic slot is granted; the
 * reason is logged by code and ids only.
 */
export async function applySubscriptionEvent(
  db: Db,
  sub: SubscriptionEvent,
  planForPrice: (priceId: string | undefined) => PlanId | null,
): Promise<SubscriptionOutcome> {
  return db.transaction(async (tx) => {
    const account = await accountForCustomer(tx, customerIdOf(sub.customer), sub.metadata?.userId);
    if (!account.ok) return refuse(sub, account.reason);
    const [existing] = await tx
      .select({ userId: schema.subscription.userId })
      .from(schema.subscription)
      .where(eq(schema.subscription.stripeSubscriptionId, sub.id))
      .for("update");
    if (existing && existing.userId !== account.userId) return refuse(sub, "subscription_owner_mismatch");

    const item = sub.items.data[0];
    const plan = planForPrice(item?.price.id) ?? (isPlanId(sub.metadata?.plan) ? sub.metadata.plan : "starter");
    const values = {
      userId: account.userId,
      stripeSubscriptionId: sub.id,
      stripePriceId: item?.price.id ?? "",
      status: sub.status,
      plan,
      activeCodeLimit: dynamicLimit(plan),
      currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
      currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
    await tx
      .insert(schema.subscription)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: schema.subscription.stripeSubscriptionId, set: values });
    return { applied: true, userId: account.userId } as const;
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
