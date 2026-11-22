import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import type { PurchaseLine } from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

export const SINGLE_ITEMS = ["single_qr", "single_qr_print_pack"] as const;
export type SingleItem = (typeof SINGLE_ITEMS)[number];

/** What this attempt charges: the item and its lines, in the checkout currency. */
export type SingleOrderCharge = { item: SingleItem; lines: PurchaseLine[]; currency: string };

/** The Stripe calls a Single QR checkout makes (the real ones in checkout.ts; stubbed in the database tests). */
export type CheckoutPort = {
  /** A Checkout Session for this order; `previous` is the attempt it replaces, if any (part of the idempotency key). */
  create(input: { orderId: string; previous: string | null }): Promise<{
    id: string;
    url: string | null;
    amount_total: number | null;
    currency: string | null;
  }>;
  retrieve(sessionId: string): Promise<{ status: string | null; url: string | null }>;
  expire(sessionId: string): Promise<unknown>;
};

export type SingleCheckoutResult =
  { ok: true; url: string; orderId: string; reused: boolean } | { ok: false; error: "not_found" | "owned" | "processing" };

/**
 * HEY-88: a Single QR checkout is one order of one account for one code. Before Stripe is called, the code (the
 * account's own, not deleted, static, still locked, with the layout when one is given) is locked and its pending
 * order is reused or created, so retries and double clicks share it. The previous attempt's session, if still open,
 * is expired first (a completed one is being paid: no second charge). The new session is attached only if no other
 * attempt attached one in between; a failed session creation leaves the order pending and retryable.
 * Plain module (no "server-only") so the PostgreSQL tests exercise it with a stubbed Stripe.
 */
export async function singleQrCheckout(
  db: Db,
  port: CheckoutPort,
  input: { userId: string; qrCodeId: string; layoutId?: string; charge: SingleOrderCharge },
): Promise<SingleCheckoutResult> {
  const { userId, qrCodeId, charge } = input;
  const amount = charge.lines.reduce((s, l) => s + l.amount, 0);
  const prepared = await db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ id: schema.qrCode.id, model: schema.qrCode.model, purchasedAt: schema.qrCode.purchasedAt })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr || qr.model !== "static") return { error: "not_found" } as const;
    if (input.layoutId !== undefined) {
      const [layout] = await tx
        .select({ id: schema.qrLayout.id })
        .from(schema.qrLayout)
        .where(and(eq(schema.qrLayout.id, input.layoutId), eq(schema.qrLayout.qrCodeId, qr.id)));
      if (!layout) return { error: "not_found" } as const;
    }
    if (qr.purchasedAt) return { error: "owned" } as const;
    const [pending] = await tx
      .select()
      .from(schema.purchase)
      .where(
        and(
          eq(schema.purchase.userId, userId),
          eq(schema.purchase.qrCodeId, qr.id),
          eq(schema.purchase.status, "pending"),
          inArray(schema.purchase.item, [...SINGLE_ITEMS]),
        ),
      )
      .orderBy(desc(schema.purchase.createdAt))
      .limit(1);
    if (pending) return { order: pending, reused: true } as const;
    const [order] = await tx
      .insert(schema.purchase)
      .values({
        id: newId(),
        userId,
        qrCodeId: qr.id,
        item: charge.item,
        lines: charge.lines,
        amountTotal: amount,
        currency: charge.currency.toLowerCase(),
      })
      .returning();
    if (!order) throw new Error("order not created");
    return { order, reused: false } as const;
  });
  if (!prepared.order) return { ok: false, error: prepared.error };
  const { order, reused } = prepared;

  const previous = order.stripeCheckoutSessionId;
  if (previous) {
    const before = await port.retrieve(previous);
    if (before.status === "complete") return { ok: false, error: "processing" };
    if (before.status === "open") {
      // Stripe refuses to expire a session that completed meanwhile: then it is being paid.
      const closed = await port.expire(previous).then(
        () => true,
        async () => (await port.retrieve(previous)).status === "expired",
      );
      if (!closed) return { ok: false, error: "processing" };
    }
  }

  const created = await port.create({ orderId: order.id, previous });
  const [attached] = await db
    .update(schema.purchase)
    .set({
      stripeCheckoutSessionId: created.id,
      item: charge.item,
      lines: charge.lines,
      amountTotal: created.amount_total ?? amount,
      currency: (created.currency ?? charge.currency).toLowerCase(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.purchase.id, order.id),
        eq(schema.purchase.status, "pending"),
        previous ? eq(schema.purchase.stripeCheckoutSessionId, previous) : isNull(schema.purchase.stripeCheckoutSessionId),
      ),
    )
    .returning({ id: schema.purchase.id });
  if (attached && created.url) return { ok: true, url: created.url, orderId: order.id, reused };

  // Another attempt attached its session first (or Stripe gave no URL): this one is never left payable.
  await port.expire(created.id).catch(() => undefined);
  const current = await db.query.purchase.findFirst({ where: eq(schema.purchase.id, order.id) });
  if (current?.status === "pending" && current.stripeCheckoutSessionId) {
    const winner = await port.retrieve(current.stripeCheckoutSessionId);
    if (winner.status === "open" && winner.url) return { ok: true, url: winner.url, orderId: order.id, reused: true };
  }
  return { ok: false, error: "processing" };
}
