import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/*
 * HEY-132 / QR-18.02: one Stripe Customer per HeyQR account, bound once in user.stripe_customer_id and used for every
 * Checkout (one-time and subscription) and the Customer Portal. Subscription events are attributed to the account that
 * holds the event's Customer, never to metadata alone.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same functions as Checkout and the webhook.
 */
type Db = NodePgDatabase<typeof schema>;

/** What a first Customer is created with: only stable account fields, so a retried create sends the same request. */
export type CustomerCreate = { email: string; metadata: { userId: string } };
/** Creates a Stripe Customer with this idempotency key (stripe.customers.create in the app, a fake in tests). */
export type CreateCustomer = (params: CustomerCreate, idempotencyKey: string) => Promise<{ id: string }>;

/** Stripe idempotency key of an account's first Customer: the same for every request and retry of that account. */
export const customerIdempotencyKey = (userId: string) => `heyqr-customer-${userId}`;

/**
 * The account's Stripe Customer ID: the stored one, or a new one created and bound once.
 * - A stored binding is returned as is (never replaced).
 * - The first creation runs under the account row lock: parallel first Checkouts of one account queue, and the ones
 *   after the first find the binding it stored.
 * - Stripe gets an account-scoped idempotency key and the same parameters, so a request that is retried after Stripe
 *   created the Customer but before the binding committed gets that same Customer back (within Stripe's key window).
 * - The binding is written only where none is stored (and stripe_customer_id is unique).
 */
export async function bindStripeCustomer(db: Db, userId: string, create: CreateCustomer): Promise<string> {
  const stored = await storedCustomer(db, userId);
  if (stored) return stored;
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ email: schema.user.email, customer: schema.user.stripeCustomerId })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update");
    if (!account) throw new Error("bindStripeCustomer: no such account");
    if (account.customer) return account.customer;
    const customer = await create({ email: account.email, metadata: { userId } }, customerIdempotencyKey(userId));
    const [bound] = await tx
      .update(schema.user)
      .set({ stripeCustomerId: customer.id })
      .where(and(eq(schema.user.id, userId), isNull(schema.user.stripeCustomerId)))
      .returning({ customer: schema.user.stripeCustomerId });
    if (!bound?.customer) throw new Error("bindStripeCustomer: binding changed meanwhile");
    return bound.customer;
  });
}

/** The account's stored Stripe Customer ID, read from the database (not from a session that may predate it). */
export async function storedCustomer(db: Pick<Db, "select">, userId: string): Promise<string | null> {
  const [row] = await db.select({ customer: schema.user.stripeCustomerId }).from(schema.user).where(eq(schema.user.id, userId));
  return row?.customer ?? null;
}

/** A Stripe object's customer field (an ID, an expanded Customer, or none). */
export const customerIdOf = (customer: string | { id: string } | null | undefined) =>
  typeof customer === "string" ? customer : (customer?.id ?? null);

export type CustomerAccount = { ok: true; userId: string } | { ok: false; reason: "no_customer" | "unknown_customer" | "account_mismatch" };

/**
 * The HeyQR account a subscription event belongs to: the one whose stored binding is the event's Customer. When the
 * event names an account (metadata.userId), it must be that same account; otherwise nothing is written or granted.
 */
export async function accountForCustomer(
  db: Pick<Db, "select">,
  customer: string | null,
  claimedUserId: string | null | undefined,
): Promise<CustomerAccount> {
  if (!customer) return { ok: false, reason: "no_customer" };
  const [owner] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.stripeCustomerId, customer));
  if (!owner) return { ok: false, reason: "unknown_customer" };
  if (claimedUserId && claimedUserId !== owner.id) return { ok: false, reason: "account_mismatch" };
  return { ok: true, userId: owner.id };
}
