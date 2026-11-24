import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Stripe from "stripe";
import * as schema from "../db/schema";
import { assignShortCode } from "../qr/short-code";
import { accountForCustomer, customerIdOf } from "./customer";
import { grantPackCredits } from "./allowances";
import { refundedOffers } from "./refunds";

type Db = NodePgDatabase<typeof schema>;
/** The database, or a transaction of it (fulfilment runs inside processCheckoutEvent's transaction). */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Receipt = { userId: string; qrCodeId: string; amountTotal: number; currency: string };
export type FulfillResult = { granted: true; receipt?: Receipt } | { granted: false; reason?: NotFulfilled };

/** The parts of a Checkout Session fulfilment reads (as delivered in checkout.session.* events). */
export type PaidSession = Pick<
  Stripe.Checkout.Session,
  | "id"
  | "mode"
  | "status"
  | "payment_status"
  | "payment_intent"
  | "amount_subtotal"
  | "amount_total"
  | "total_details"
  | "currency"
  | "metadata"
> &
  // HEY-132: read for subscription Checkout (the account is the one bound to this Customer).
  Partial<Pick<Stripe.Checkout.Session, "customer">>;

/** Why a one-time Checkout was not fulfilled (logged by code, never with the payload). */
export type NotFulfilled =
  | "no_order"
  | "already_paid"
  | "order_closed"
  | "owner_mismatch"
  | "order_mismatch"
  | "qr_mismatch"
  | "not_paid"
  | "missing_amounts"
  | "currency_mismatch"
  | "subtotal_mismatch"
  | "total_mismatch"
  // HEY-132: a subscription Checkout whose Customer isn't the account's stored one (or names another account).
  | "no_customer"
  | "unknown_customer"
  | "account_mismatch";

type Order = typeof schema.purchase.$inferSelect;

/**
 * HEY-96: whether this session pays this stored order, in minor units, before anything is marked paid.
 * - The session is the one attached to the order (the caller found the order by it), for the order's account and,
 *   where named, the order's own id and code; Stripe reports it complete and paid.
 * - Same currency as the order; Stripe's item subtotal equals the order's purchase-time lines (a legacy order
 *   without lines: its recorded amount, which was the session's item total when it was created).
 * - The paid total follows from that subtotal with Stripe's own discount (promotion codes) and tax (automatic tax),
 *   tax either on top (exclusive prices) or already inside the subtotal (inclusive), no shipping.
 * The expected subtotal is never replaced by what was paid; the paid total is stored separately once verified.
 */
export function verifyCheckoutPayment(order: Order, s: PaidSession): { ok: true; paid: number } | { ok: false; reason: NotFulfilled } {
  const fail = (reason: NotFulfilled) => ({ ok: false, reason }) as const;
  const meta = s.metadata ?? {};
  if (order.status === "paid") return fail("already_paid");
  if (order.status !== "pending") return fail("order_closed");
  if (meta.userId !== order.userId) return fail("owner_mismatch");
  if (meta.orderId !== undefined && meta.orderId !== order.id) return fail("order_mismatch");
  if (order.qrCodeId !== null ? meta.qrCodeId !== undefined && meta.qrCodeId !== order.qrCodeId : meta.qrCodeId !== undefined)
    return fail("qr_mismatch");
  if (s.status !== "complete" || s.payment_status !== "paid") return fail("not_paid");

  const subtotal = s.amount_subtotal;
  const total = s.amount_total;
  const discount = s.total_details?.amount_discount ?? 0;
  const tax = s.total_details?.amount_tax ?? 0;
  const shipping = s.total_details?.amount_shipping ?? 0;
  if (subtotal === null || total === null || !s.currency || !s.total_details) return fail("missing_amounts");
  if (![subtotal, total, discount, tax, shipping].every((n) => Number.isInteger(n) && n >= 0)) return fail("missing_amounts");
  if (s.currency.toLowerCase() !== order.currency.toLowerCase()) return fail("currency_mismatch");
  const expected = order.lines?.length ? order.lines.reduce((sum, l) => sum + l.amount, 0) : order.amountTotal;
  if (subtotal !== expected) return fail("subtotal_mismatch");
  if (discount > subtotal || shipping !== 0) return fail("total_mismatch");
  const exclusive = subtotal - discount + tax;
  const inclusive = subtotal - discount;
  if (total !== exclusive && !(tax <= inclusive && total === inclusive)) return fail("total_mismatch");
  return { ok: true, paid: total };
}

const diagnose = (reason: NotFulfilled, orderId: string | null, sessionId: string) =>
  // Codes and ids only: never the event, amounts of another order, metadata or customer data.
  console.warn(`[billing] checkout not fulfilled: ${reason} order=${orderId ?? "-"} session=…${sessionId.slice(-6)}`);

/**
 * HEY-87: fulfils one paid Checkout Session for the order it created, exactly once. The purchase row moves to "paid"
 * only from pending, and only that first transition grants anything: a Static Pack's credits, a code's Print Pack, or
 * a Single QR unlock (with its Print Pack when it was on the order). A repeated delivery, or the second of
 * checkout.session.completed / async_payment_succeeded for the same session, finds the order already paid and changes
 * nothing (no second unlock time, no second receipt).
 * HEY-96: one-time payments are verified against the stored order first (verifyCheckoutPayment); on a mismatch the
 * order and entitlements stay unchanged and the reason is logged. What is granted, and to which account and code,
 * comes from the stored order only.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same fulfilment as the webhook.
 */
export async function fulfillCheckout(db: Db | Tx, s: PaidSession, newShortCode: () => string): Promise<FulfillResult> {
  const { qrCodeId, printPack } = s.metadata ?? {};
  const now = new Date();

  if (s.mode === "subscription") {
    if (s.payment_status !== "paid") return { granted: false };
    // HEY-132: the account is the one bound to the session's Stripe Customer; metadata.userId must agree when present.
    const account = await accountForCustomer(db, customerIdOf(s.customer), s.metadata?.userId);
    if (!account.ok) {
      diagnose(account.reason, null, s.id);
      return { granted: false, reason: account.reason };
    }
    const userId = account.userId;
    const ownCode = qrCodeId ? and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId)) : undefined;
    if (!ownCode) return { granted: false };
    // Lock order: the account row first, then the code row, as trial and plan activation do (activateTrialCode,
    // activateDynamicCode). The code row is updated twice below (slug, then status); the second update touches a row
    // version this transaction wrote, so PostgreSQL re-checks the qr_code.user_id foreign key and takes FOR KEY SHARE
    // on the account row. Without this lock the webhook could hold the code row while waiting for the account row that
    // an activation holds while waiting for the code row: a deadlock (40P01). Taking the account row here first makes
    // the webhook queue behind the activation instead, and serializes it with the account's slot counting.
    await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
    // A plan bought for a code (export or the trial's test code): the code goes live and keeps its short link.
    const qr = await db.query.qrCode.findFirst({ where: ownCode });
    if (!qr) return { granted: false };
    // HEY-117: assigned once, from NULL, converging with a concurrent trial or plan activation of the same code.
    await assignShortCode(db, qr.id, newShortCode);
    await db
      .update(schema.qrCode)
      // The trial's test code becomes a regular code of the plan (design 9.4: same short link, takes a live slot).
      // HEY-127: a code its owner paused stays paused (a delayed Checkout event never resumes it); Resume turns it on.
      .set({
        status: qr.status === "paused" ? "paused" : "active",
        isTrial: false,
        ...(printPack === "1" ? { printPackAt: qr.printPackAt ?? now } : {}),
      })
      .where(ownCode);
    return { granted: true };
  }
  if (s.mode !== "payment") return { granted: false };

  // HEY-88: the stored order is authoritative, found by the session attached to it (a replaced session finds none).
  // HEY-97: locked for the rest of the transaction, so a concurrent delivery for the same order waits and then finds it
  // paid (one paid transition, one set of grants).
  const [order] = await db.select().from(schema.purchase).where(eq(schema.purchase.stripeCheckoutSessionId, s.id)).for("update");
  if (!order) {
    // An unpaid session for no order (e.g. a Checkout that was never ours) isn't worth a warning.
    if (s.payment_status === "paid") diagnose("no_order", null, s.id);
    return { granted: false, reason: "no_order" };
  }
  const verdict = verifyCheckoutPayment(order, s);
  if (!verdict.ok) {
    // A repeated delivery of a fulfilled order, or an unpaid attempt, is expected: no warning for those.
    if (verdict.reason !== "already_paid" && verdict.reason !== "not_paid") diagnose(verdict.reason, order.id, s.id);
    return { granted: false, reason: verdict.reason };
  }

  // Paid now for the first time (null when a concurrent delivery got there first, or the session was replaced).
  const [row] = await db
    .update(schema.purchase)
    .set({ status: "paid", paidAt: now, stripePaymentIntentId: String(s.payment_intent ?? ""), amountTotal: verdict.paid })
    .where(and(eq(schema.purchase.id, order.id), eq(schema.purchase.stripeCheckoutSessionId, s.id), eq(schema.purchase.status, "pending")))
    .returning();
  if (!row) return { granted: false, reason: "already_paid" };

  if (row.item === "pack3" || row.item === "pack10") {
    // Design 4.8 Static Pack: its credits, once per purchase, to the order's account.
    await grantPackCredits(db, row.userId, row.id, row.item);
    return { granted: true };
  }
  if (!row.qrCodeId) return { granted: false };
  // The order's own code of the order's own account.
  const orderCode = and(eq(schema.qrCode.id, row.qrCodeId), eq(schema.qrCode.userId, row.userId));
  // HEY-100: a line refunded before this payment event arrived is not granted (the order stays paid for the rest).
  const refunded = await refundedOffers(db, row.id);
  const base = (row.item === "single_qr" || row.item === "single_qr_print_pack") && !refunded.has("single");
  const withPrintPack = (row.item === "print_pack" || row.item === "single_qr_print_pack") && !refunded.has("printPack");
  // Single QR (design 7.3), its Print Pack when it was on the order, or a standalone Print Pack (design 8.x) on an
  // unlocked code. Each keeps an earlier time; a standalone Print Pack never changes the code's unlock.
  if (base || withPrintPack)
    await db
      .update(schema.qrCode)
      .set({
        ...(base ? { purchasedAt: sql`coalesce(${schema.qrCode.purchasedAt}, now())`, status: "active" as const } : {}),
        ...(withPrintPack ? { printPackAt: sql`coalesce(${schema.qrCode.printPackAt}, now())` } : {}),
      })
      .where(orderCode);
  if (!base) return { granted: true };
  // The receipt goes out after the transaction commits (processCheckoutEvent's caller): an email failure never undoes a
  // purchase, and a rolled-back one never sends a receipt.
  return { granted: true, receipt: { userId: row.userId, qrCodeId: row.qrCodeId, amountTotal: row.amountTotal, currency: row.currency } };
}

/**
 * HEY-97: one Stripe checkout event, atomically. In one PostgreSQL transaction: claim the event (webhook_event), lock
 * and verify the stored order, move it to paid and apply its grants. If any of it fails, everything rolls back,
 * the event included, so Stripe's retry of the same event is processed again. A second delivery of the same event
 * waits for the first and finds it claimed; a different event for the same session finds the order paid.
 */
export async function processCheckoutEvent(
  db: Db,
  event: { id: string; type: string; session: PaidSession },
  newShortCode: () => string,
): Promise<{ duplicate: true } | { duplicate: false; result: FulfillResult }> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(schema.webhookEvent)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvent.id });
    if (!claimed) return { duplicate: true } as const;
    return { duplicate: false, result: await fulfillCheckout(tx, event.session, newShortCode) } as const;
  });
}
