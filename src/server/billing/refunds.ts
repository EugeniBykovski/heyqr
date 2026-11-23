import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import type { PurchaseLine } from "../db/schema";

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Offer = PurchaseLine["offer"];
type Order = typeof schema.purchase.$inferSelect;

/** The parts of a Stripe Refund this reads (refund.created / refund.updated). */
export type RefundIn = {
  id: string;
  status: string | null;
  amount: number;
  currency: string;
  payment_intent: string | null;
  metadata: Record<string, string> | null;
};

/** For an order whose payment the webhook hasn't recorded yet: its Checkout Session and the amount Stripe received. */
export type PaymentLookup = (paymentIntentId: string) => Promise<{ sessionId: string | null; amountPaid: number | null }>;

export type RefundReview =
  | "unknown_order"
  | "currency_mismatch"
  | "missing_payment"
  | "nothing_left"
  | "unknown_line"
  | "line_already_refunded"
  | "allocation_amount_mismatch"
  | "partial_unallocated";

export type RefundResult =
  | { duplicate: true }
  | { duplicate: false; outcome: "ignored"; reason: "not_succeeded" }
  | { duplicate: false; outcome: "applied"; lines: Offer[]; creditsRemoved: number }
  | { duplicate: false; outcome: "review"; reason: RefundReview };

/** Metadata key for refunding specific lines of an order, e.g. "printPack" or "single,printPack". */
export const REFUND_LINES_KEY = "heyqr_lines";

const OFFERS: readonly Offer[] = ["single", "printPack", "pack3", "pack10"];
const isOffer = (v: string): v is Offer => (OFFERS as readonly string[]).includes(v);

/** The order's lines as bought; a legacy order without lines is one line of its item (a combined one can't be split). */
function orderLines(order: Order): PurchaseLine[] {
  if (order.lines?.length) return order.lines;
  const offer: Offer | null =
    order.item === "single_qr"
      ? "single"
      : order.item === "print_pack"
        ? "printPack"
        : order.item === "pack3" || order.item === "pack10"
          ? order.item
          : null;
  return offer ? [{ offer, amount: order.amountTotal }] : [];
}

/**
 * What each line actually cost: the paid total split over the purchase-time line amounts (discounts and tax spread in
 * proportion), the last line taking the rounding so the shares add up to the paid total exactly.
 */
export function paidShares(lines: PurchaseLine[], paidTotal: number): Map<Offer, number> {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const shares = new Map<Offer, number>();
  let given = 0;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? paidTotal - given : subtotal === 0 ? 0 : Math.floor((l.amount * paidTotal) / subtotal);
    shares.set(l.offer, (shares.get(l.offer) ?? 0) + share);
    given += share;
  });
  return shares;
}

/** Lines of an order already refunded in full (applied refunds). */
export async function refundedOffers(db: Db | Tx, purchaseId: string): Promise<Set<Offer>> {
  const rows = await db
    .select({ lines: schema.refund.lines })
    .from(schema.refund)
    .where(and(eq(schema.refund.purchaseId, purchaseId), eq(schema.refund.outcome, "applied")));
  return new Set(rows.flatMap((r) => r.lines ?? []));
}

/**
 * HEY-100 credit attribution: a pack's unused credits, first in, first out. Credits are spent from the oldest pack
 * that still has some (ledger order: created_at, then id); a refund's removal takes from its own pack. Existing
 * ledger entries are attributed the same way, since unlock debits never named a pack.
 */
export async function unusedPackCredits(db: Db | Tx, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId))
    .orderBy(asc(schema.creditLedger.createdAt), asc(schema.creditLedger.id));
  const packs: { purchaseId: string; left: number }[] = [];
  for (const r of rows) {
    if ((r.reason === "pack3" || r.reason === "pack10") && r.purchaseId && r.delta > 0)
      packs.push({ purchaseId: r.purchaseId, left: r.delta });
    else if (r.reason === "refund" && r.purchaseId) {
      const p = packs.find((x) => x.purchaseId === r.purchaseId);
      if (p) p.left = Math.max(0, p.left + r.delta);
    } else if (r.reason === "unlock") {
      let spend = -r.delta;
      for (const p of packs) {
        if (spend <= 0) break;
        const take = Math.min(p.left, spend);
        p.left -= take;
        spend -= take;
      }
    }
  }
  return new Map(packs.map((p) => [p.purchaseId, p.left]));
}

/** Another paid purchase of the code still grants this line, or a credit or plan allowance did: then it stays. */
async function otherSource(tx: Tx, order: Order, qrCodeId: string, offer: "single" | "printPack"): Promise<boolean> {
  const items = offer === "single" ? (["single_qr", "single_qr_print_pack"] as const) : (["single_qr_print_pack", "print_pack"] as const);
  const others = await tx
    .select({ id: schema.purchase.id })
    .from(schema.purchase)
    .where(
      and(
        eq(schema.purchase.qrCodeId, qrCodeId),
        ne(schema.purchase.id, order.id),
        eq(schema.purchase.status, "paid"),
        inArray(schema.purchase.item, [...items]),
      ),
    );
  for (const o of others) if (!(await refundedOffers(tx, o.id)).has(offer)) return true;
  const [allowance] = await tx
    .select({ id: schema.allowanceUse.id })
    .from(schema.allowanceUse)
    .where(
      and(eq(schema.allowanceUse.qrCodeId, qrCodeId), eq(schema.allowanceUse.kind, offer === "single" ? "static_unlock" : "print_pack")),
    )
    .limit(1);
  if (allowance) return true;
  if (offer === "printPack") return false;
  const [credit] = await tx
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.qrCodeId, qrCodeId), eq(schema.creditLedger.reason, "unlock")))
    .limit(1);
  return Boolean(credit);
}

type Allocation = { ok: true; lines: Offer[]; all: boolean } | { ok: false; reason: RefundReview };

/**
 * Which order lines this refund refunds in full. Explicit: the refund's `heyqr_lines` metadata names them, and its
 * amount equals their paid share. Otherwise only a refund of everything still unrefunded counts. A partial refund
 * without an allocation is never guessed from its amount (a 2.99 refund isn't assumed to be the Print Pack).
 */
function allocate(order: Order, r: RefundIn, paidTotal: number, refunded: Set<Offer>): Allocation {
  const lines = orderLines(order);
  if (!lines.length) return { ok: false, reason: "unknown_line" };
  const remaining = lines.map((l) => l.offer).filter((o) => !refunded.has(o));
  if (!remaining.length) return { ok: false, reason: "nothing_left" };
  const shares = paidShares(lines, paidTotal);
  const shareOf = (offers: Offer[]) => offers.reduce((s, o) => s + (shares.get(o) ?? 0), 0);
  const named = r.metadata?.[REFUND_LINES_KEY];
  if (named !== undefined) {
    const offers = [
      ...new Set(
        named
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (!offers.length || !offers.every((o) => isOffer(o) && lines.some((l) => l.offer === o)))
      return { ok: false, reason: "unknown_line" };
    const chosen = offers.filter(isOffer);
    if (chosen.some((o) => refunded.has(o))) return { ok: false, reason: "line_already_refunded" };
    if (r.amount !== shareOf(chosen)) return { ok: false, reason: "allocation_amount_mismatch" };
    return { ok: true, lines: chosen, all: chosen.length === remaining.length };
  }
  if (r.amount === shareOf(remaining)) return { ok: true, lines: remaining, all: true };
  return { ok: false, reason: "partial_unallocated" };
}

const diagnose = (reason: RefundReview, refundId: string, orderId: string | null) =>
  // Codes and ids only, never the refund object or its metadata.
  console.warn(`[billing] refund recorded for review: ${reason} refund=…${refundId.slice(-6)} order=${orderId ?? "-"}`);

/**
 * HEY-100: one confirmed (succeeded) Stripe refund, applied once and atomically with the event claim (HEY-97). The
 * refund is resolved to its stored order by the payment (or, before the payment was recorded, by Stripe's Checkout
 * Session for it) and allocated to whole lines. Applied lines revoke their entitlement unless another purchase, credit
 * or allowance also grants it; a pack's unused credits are removed (credits already spent keep their codes unlocked).
 * An order with every line refunded becomes "refunded", so a late payment event can't grant it (order_closed); a
 * combined order with only its Print Pack refunded stays paid and a late event grants only what's left. Anything
 * ambiguous or inconsistent is recorded as `review` and changes nothing.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same path as the webhook.
 */
export async function processRefundEvent(
  db: Db,
  event: { id: string; type: string; refund: RefundIn },
  lookup: PaymentLookup,
): Promise<RefundResult> {
  const r = event.refund;
  if (r.status !== "succeeded") return { duplicate: false, outcome: "ignored", reason: "not_succeeded" };

  // Outside the transaction: an order whose payment isn't recorded yet is found through Stripe.
  let viaSession: { sessionId: string | null; amountPaid: number | null } | null = null;
  if (r.payment_intent) {
    const [byPayment] = await db
      .select({ id: schema.purchase.id })
      .from(schema.purchase)
      .where(eq(schema.purchase.stripePaymentIntentId, r.payment_intent));
    if (!byPayment) viaSession = await lookup(r.payment_intent);
  }

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(schema.webhookEvent)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvent.id });
    if (!claimed) return { duplicate: true } as const;

    const record = async (values: Partial<typeof schema.refund.$inferInsert> & { outcome: "applied" | "review" }) => {
      const [row] = await tx
        .insert(schema.refund)
        .values({ id: r.id, amount: r.amount, currency: r.currency.toLowerCase(), stripePaymentIntentId: r.payment_intent, ...values })
        .onConflictDoNothing()
        .returning({ id: schema.refund.id });
      return Boolean(row);
    };
    const review = async (reason: RefundReview, order: Order | null) => {
      if (!(await record({ outcome: "review", reason, purchaseId: order?.id ?? null, userId: order?.userId ?? null })))
        return { duplicate: true } as const;
      diagnose(reason, r.id, order?.id ?? null);
      return { duplicate: false, outcome: "review", reason } as const;
    };

    const where = r.payment_intent
      ? viaSession?.sessionId
        ? eq(schema.purchase.stripeCheckoutSessionId, viaSession.sessionId)
        : eq(schema.purchase.stripePaymentIntentId, r.payment_intent)
      : null;
    // Locked: a payment event or another refund for this order waits for this one.
    const [order] = where ? await tx.select().from(schema.purchase).where(where).for("update") : [];
    if (!order) return review("unknown_order", null);
    // The same refund through another event (refund.created, then refund.updated) is applied once.
    const [seen] = await tx.select({ id: schema.refund.id }).from(schema.refund).where(eq(schema.refund.id, r.id));
    if (seen) return { duplicate: true } as const;
    if (r.currency.toLowerCase() !== order.currency.toLowerCase()) return review("currency_mismatch", order);
    const paidTotal = order.status === "pending" ? (viaSession?.amountPaid ?? null) : order.amountTotal;
    if (paidTotal === null) return review("missing_payment", order);

    const refunded = await refundedOffers(tx, order.id);
    const allocation = allocate(order, r, paidTotal, refunded);
    if (!allocation.ok) return review(allocation.reason, order);

    // Credits and redemptions of this account wait for each other (as unlockStatic does).
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, order.userId)).for("update");
    const granted = order.status === "paid";
    let creditsRemoved = 0;
    for (const offer of allocation.lines) {
      if (!granted) continue; // nothing was granted yet: the late payment event grants only what's left
      if ((offer === "single" || offer === "printPack") && order.qrCodeId && !(await otherSource(tx, order, order.qrCodeId, offer))) {
        await tx
          .update(schema.qrCode)
          .set(offer === "single" ? { purchasedAt: null, status: "draft" } : { printPackAt: null })
          .where(and(eq(schema.qrCode.id, order.qrCodeId), eq(schema.qrCode.userId, order.userId)));
      }
      if (offer === "pack3" || offer === "pack10") {
        const unused = (await unusedPackCredits(tx, order.userId)).get(order.id) ?? 0;
        if (unused > 0) {
          await tx
            .insert(schema.creditLedger)
            .values({ id: newId(), userId: order.userId, delta: -unused, reason: "refund", purchaseId: order.id });
          creditsRemoved = unused;
        }
      }
    }
    if (allocation.all)
      await tx.update(schema.purchase).set({ status: "refunded", updatedAt: new Date() }).where(eq(schema.purchase.id, order.id));
    await record({ outcome: "applied", purchaseId: order.id, userId: order.userId, lines: allocation.lines, creditsRemoved });
    return { duplicate: false, outcome: "applied", lines: allocation.lines, creditsRemoved } as const;
  });
}
