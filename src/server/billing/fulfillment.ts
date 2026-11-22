import { and, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Stripe from "stripe";
import * as schema from "../db/schema";
import { grantPackCredits } from "./allowances";

type Db = NodePgDatabase<typeof schema>;
export type Receipt = { userId: string; qrCodeId: string; amountTotal: number; currency: string };

/**
 * HEY-87: fulfils one paid Checkout Session for the order it created, exactly once. The purchase row moves to "paid"
 * only from another state, and only that first transition grants anything: a Static Pack's credits, a code's Print
 * Pack, or a Single QR unlock (with its Print Pack when it was on the order). A repeated delivery, or the second of
 * checkout.session.completed / async_payment_succeeded for the same session, finds the order already paid and changes
 * nothing (no second unlock time, no second receipt). An unpaid session grants nothing.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same fulfilment as the webhook.
 */
export async function fulfillCheckout(
  db: Db,
  s: Pick<Stripe.Checkout.Session, "id" | "mode" | "payment_status" | "payment_intent" | "amount_total" | "currency" | "metadata">,
  newShortCode: () => string,
  receipt?: (r: Receipt) => Promise<unknown>,
): Promise<{ granted: boolean }> {
  const { userId, qrCodeId, kind, pack, printPack } = s.metadata ?? {};
  if (!userId || s.payment_status !== "paid") return { granted: false };
  const now = new Date();
  const ownCode = qrCodeId ? and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId)) : undefined;

  if (s.mode === "subscription") {
    if (!ownCode) return { granted: false };
    // A plan bought for a code (export or the trial's test code): the code goes live and keeps its short link.
    const qr = await db.query.qrCode.findFirst({ where: ownCode });
    if (!qr) return { granted: false };
    await db
      .update(schema.qrCode)
      // The trial's test code becomes a regular code of the plan (design 9.4: same short link, takes a live slot).
      .set({
        shortCode: qr.shortCode ?? newShortCode(),
        status: "active",
        isTrial: false,
        ...(printPack === "1" ? { printPackAt: qr.printPackAt ?? now } : {}),
      })
      .where(ownCode);
    return { granted: true };
  }
  if (s.mode !== "payment") return { granted: false };

  // HEY-88: the stored order is authoritative. It is found by the session attached to it; a session whose metadata
  // names another order, account or code than that order's own is refused before anything is marked paid.
  const order = await db.query.purchase.findFirst({ where: eq(schema.purchase.stripeCheckoutSessionId, s.id) });
  if (!order || order.userId !== userId) return { granted: false };
  if (s.metadata?.orderId !== undefined && s.metadata.orderId !== order.id) return { granted: false };
  if (order.qrCodeId !== null && qrCodeId !== undefined && qrCodeId !== order.qrCodeId) return { granted: false };

  // Paid now for the first time (null when it was already paid, or its session was replaced meanwhile).
  const [row] = await db
    .update(schema.purchase)
    .set({ status: "paid", paidAt: now, stripePaymentIntentId: String(s.payment_intent ?? ""), amountTotal: s.amount_total ?? 0 })
    .where(and(eq(schema.purchase.id, order.id), eq(schema.purchase.stripeCheckoutSessionId, s.id), ne(schema.purchase.status, "paid")))
    .returning();
  if (!row) return { granted: false };

  if (kind === "pack" && (pack === "pack3" || pack === "pack10")) {
    // Design 4.8 Static Pack: its credits, once per purchase.
    await grantPackCredits(db, userId, row.id, pack);
    return { granted: true };
  }
  if (!row.qrCodeId) return { granted: false };
  // The order's own code of the order's own account.
  const orderCode = and(eq(schema.qrCode.id, row.qrCodeId), eq(schema.qrCode.userId, row.userId));
  if (row.item === "print_pack") {
    // Design 8.x: the Print Pack of an already unlocked code; the code itself doesn't change.
    await db
      .update(schema.qrCode)
      .set({ printPackAt: sql`coalesce(${schema.qrCode.printPackAt}, now())` })
      .where(orderCode);
    return { granted: true };
  }
  if (row.item !== "single_qr" && row.item !== "single_qr_print_pack") return { granted: false };
  // Single QR, with its Print Pack when it was on the order (design 7.3). An earlier unlock keeps its time.
  await db
    .update(schema.qrCode)
    .set({
      purchasedAt: sql`coalesce(${schema.qrCode.purchasedAt}, now())`,
      status: "active",
      ...(row.item === "single_qr_print_pack" ? { printPackAt: sql`coalesce(${schema.qrCode.printPackAt}, now())` } : {}),
    })
    .where(orderCode);
  await receipt?.({
    userId: row.userId,
    qrCodeId: row.qrCodeId,
    amountTotal: row.amountTotal ?? s.amount_total ?? 0,
    currency: s.currency ?? "usd",
  });
  return { granted: true };
}
