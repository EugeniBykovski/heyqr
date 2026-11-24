import { and, count, desc, eq, gte, inArray, isNull, sum } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PACK_CREDITS, PLANS, type PlanId } from "../../shared/config/catalog-core";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import { assignShortCode } from "../qr/short-code";

/*
 * Design 4.8 allowances: what an account can unlock without paying again.
 * - Static credits (Static Packs): one credit unlocks one static code, credits don't expire.
 * - A plan's monthly allowances (Starter 10 static unlocks; Studio 40 and 5 Print Packs): counted from the current
 *   billing period's start, so they reset with renewal and unused ones don't roll over.
 * - Live Dynamic slots: Starter 5, Studio 25 active Dynamic codes at once.
 * Every unlock happens here, on the server, in one transaction with its check. Plain module so tests use the same code.
 */
type Db = NodePgDatabase<typeof schema>;
/**
 * Stripe subscription statuses that count as the plan, the one policy for slots, allowances, downloads and the trial's
 * upgraded state. past_due keeps the plan while Stripe retries a failed renewal; any other status (canceled, unpaid,
 * incomplete, incomplete_expired, paused) means no plan. How long Stripe retries is its own (Dashboard) setting.
 */
export const PLAN_STATUSES = ["active", "trialing", "past_due"];
const ACTIVE = PLAN_STATUSES;

/** The subscription fields that decide paid access at a moment in time. */
export type AccessFields = { status: string; cancelAtPeriodEnd: boolean; cancelAt: Date | null; currentPeriodEnd: Date | null };

/**
 * HEY-142: the one rule for paid access (published in HEY-138, docs/LINK_AVAILABILITY.md), at time `now`:
 * - Stripe's status counts as the plan (PLAN_STATUSES: past_due keeps it while a failed renewal is retried);
 * - a scheduled cancellation keeps it through the paid period and ends it at its cutoff (Stripe's cancel_at, else the
 *   period end), even before Stripe's final cancellation event has arrived (a delayed webhook can't extend access);
 * - a renewing subscription (no cancellation scheduled) keeps it past its period end: Stripe renews it, and a failed
 *   renewal becomes past_due (still the plan) or unpaid/canceled (no plan) through the webhook.
 */
export function hasPlanAccess(sub: AccessFields, now: Date = new Date()): boolean {
  if (!PLAN_STATUSES.includes(sub.status)) return false;
  if (!sub.cancelAtPeriodEnd) return true;
  const cutoff = sub.cancelAt ?? sub.currentPeriodEnd;
  return !cutoff || now < cutoff;
}

/** `endsAt`: when a scheduled cancellation takes effect (Stripe's cancel_at, else the period end); null if none. */
export type Plan = {
  id: PlanId;
  periodStart: Date;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  endsAt: Date | null;
  /** HEY-141: true while a renewal payment is overdue (past_due): the plan stays, the payment is due. */
  overdue: boolean;
};

export async function currentPlan(db: Db, userId: string, now: Date = new Date()): Promise<Plan | null> {
  const subs = await db.query.subscription.findMany({
    where: and(eq(schema.subscription.userId, userId), inArray(schema.subscription.status, ACTIVE)),
  });
  // HEY-142: a subscription past its scheduled cutoff is no plan, whatever its stored status still says.
  const sub = subs.find((s) => hasPlanAccess(s, now));
  if (!sub) return null;
  return {
    id: sub.plan,
    // Without a period start from Stripe (older rows), the month before the period end, else the subscription's start.
    periodStart:
      sub.currentPeriodStart ?? (sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd.getTime() - 30 * 86_400_000) : sub.createdAt),
    periodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    endsAt: sub.cancelAtPeriodEnd ? (sub.cancelAt ?? sub.currentPeriodEnd) : null,
    overdue: sub.status === "past_due",
  };
}

/**
 * HEY-141: the account's subscription whose renewal payment failed and can still be paid: past_due (the plan stays,
 * HEY-138) or unpaid (the plan has ended, the invoice is still open). Paying the open invoice in Stripe makes it active
 * again; the webhook then reconciles it (HEY-134). Null when nothing is owed.
 */
export async function overdueSubscription(db: Db, userId: string) {
  const [sub] = await db
    .select({
      stripeSubscriptionId: schema.subscription.stripeSubscriptionId,
      status: schema.subscription.status,
      plan: schema.subscription.plan,
    })
    .from(schema.subscription)
    .where(and(eq(schema.subscription.userId, userId), inArray(schema.subscription.status, ["past_due", "unpaid"])))
    .orderBy(desc(schema.subscription.updatedAt))
    .limit(1);
  return sub ?? null;
}

export async function creditBalance(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sum(schema.creditLedger.delta) })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId));
  return Number(row?.n ?? 0);
}

async function used(db: Db, userId: string, kind: "static_unlock" | "print_pack", since: Date) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.allowanceUse)
    .where(and(eq(schema.allowanceUse.userId, userId), eq(schema.allowanceUse.kind, kind), gte(schema.allowanceUse.periodStart, since)));
  return Number(row?.n ?? 0);
}

export type Usage = {
  plan: Plan | null;
  credits: number;
  unlocks: { used: number; limit: number };
  packs: { used: number; limit: number };
  dynamic: { used: number; limit: number };
};

/** Design 4.9 / 9.6: the account's credits, this period's allowances and its live Dynamic slots. */
export async function accountUsage(db: Db, userId: string, now: Date = new Date()): Promise<Usage> {
  const plan = await currentPlan(db, userId, now);
  const def = plan ? PLANS[plan.id] : null;
  const [credits, unlocksUsed, packsUsed, [live]] = await Promise.all([
    creditBalance(db, userId),
    plan ? used(db, userId, "static_unlock", plan.periodStart) : Promise.resolve(0),
    plan ? used(db, userId, "print_pack", plan.periodStart) : Promise.resolve(0),
    db
      .select({ n: count() })
      .from(schema.qrCode)
      .where(
        and(
          eq(schema.qrCode.userId, userId),
          eq(schema.qrCode.model, "dynamic"),
          eq(schema.qrCode.status, "active"),
          eq(schema.qrCode.isTrial, false),
          isNull(schema.qrCode.deletedAt),
        ),
      ),
  ]);
  return {
    plan,
    credits,
    unlocks: { used: unlocksUsed, limit: def?.unlocks ?? 0 },
    packs: { used: packsUsed, limit: def?.packs ?? 0 },
    dynamic: { used: Number(live?.n ?? 0), limit: def?.dyn ?? 0 },
  };
}

export type UnlockResult =
  { ok: true; via: "plan" | "credit" } | { ok: false; error: "not_found" | "not_static" | "owned" | "no_allowance" | "no_credits" };

/**
 * Design 7.5 "Use 1 included unlock" / "Use 1 static credit": unlocks a static code without a payment. The check and
 * the unlock run in one transaction, so two clicks can't spend twice or unlock past the allowance.
 */
export async function unlockStatic(
  db: Db,
  userId: string,
  qrCodeId: string,
  via: "plan" | "credit",
  now = new Date(),
): Promise<UnlockResult> {
  return db.transaction(async (tx) => {
    // Serialise this account's unlocks (allowances and credits are per account).
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
    // HEY-135: account row, then the code row (the order every path that consumes a quota or writes the code uses).
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" };
    if (qr.model !== "static") return { ok: false, error: "not_static" };
    if (qr.purchasedAt) return { ok: false, error: "owned" };
    if (via === "plan") {
      const plan = await currentPlan(tx as unknown as Db, userId);
      if (!plan || (await used(tx as unknown as Db, userId, "static_unlock", plan.periodStart)) >= PLANS[plan.id].unlocks)
        return { ok: false, error: "no_allowance" };
      await tx.insert(schema.allowanceUse).values({ id: newId(), userId, kind: "static_unlock", qrCodeId, periodStart: plan.periodStart });
    } else {
      if ((await creditBalance(tx as unknown as Db, userId)) < 1) return { ok: false, error: "no_credits" };
      await tx.insert(schema.creditLedger).values({ id: newId(), userId, delta: -1, reason: "unlock", qrCodeId });
    }
    await tx.update(schema.qrCode).set({ purchasedAt: now, status: "active" }).where(eq(schema.qrCode.id, qrCodeId));
    return { ok: true, via };
  });
}

/** Design 8.4 "Use 1 included Print Pack" (Studio): this code's Print Pack from the plan's monthly allowance. */
export async function applyPrintPackAllowance(
  db: Db,
  userId: string,
  qrCodeId: string,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: "not_found" | "owned" | "no_allowance" }> {
  return db.transaction(async (tx) => {
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
    // HEY-135: account row, then the code row (the order every path that consumes a quota or writes the code uses).
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" };
    if (qr.printPackAt) return { ok: false, error: "owned" };
    const plan = await currentPlan(tx as unknown as Db, userId);
    if (!plan || (await used(tx as unknown as Db, userId, "print_pack", plan.periodStart)) >= PLANS[plan.id].packs)
      return { ok: false, error: "no_allowance" };
    await tx.insert(schema.allowanceUse).values({ id: newId(), userId, kind: "print_pack", qrCodeId, periodStart: plan.periodStart });
    await tx.update(schema.qrCode).set({ printPackAt: now }).where(eq(schema.qrCode.id, qrCodeId));
    return { ok: true };
  });
}

/** A paid Static Pack adds its credits once (the purchase id is unique in the ledger, so webhook retries are no-ops). */
/** Inside the fulfilment transaction (HEY-97): `db` may be that transaction. Once per purchase (unique purchase_id). */
export async function grantPackCredits(db: Pick<Db, "insert">, userId: string, purchaseId: string, pack: keyof typeof PACK_CREDITS) {
  await db
    .insert(schema.creditLedger)
    .values({ id: newId(), userId, delta: PACK_CREDITS[pack], reason: pack, purchaseId })
    .onConflictDoNothing();
}

/** Live Dynamic slots of a plan (design: Starter 5, Studio 25). */
export const dynamicLimit = (plan: PlanId | null | undefined) => (plan ? PLANS[plan].dyn : 0);

/**
 * Design 7.7: a Dynamic code goes live under the plan when a live slot is free (Starter 5, Studio 25). It keeps its
 * short link if it had one. Checked and applied in one transaction, so two codes can't take the last slot.
 */
export async function activateDynamicCode(
  db: Db,
  userId: string,
  qrCodeId: string,
  newShortCode: () => string,
): Promise<{ ok: true; shortCode: string } | { ok: false; error: "not_found" | "not_dynamic" | "no_plan" | "limit" }> {
  return db.transaction(async (tx) => {
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
    // HEY-135: account row, then the code row (the order every path that consumes a quota or writes the code uses).
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" };
    if (qr.model !== "dynamic") return { ok: false, error: "not_dynamic" };
    if (qr.status === "active" && qr.shortCode && !qr.isTrial) return { ok: true, shortCode: qr.shortCode };
    const usage = await accountUsage(tx as unknown as Db, userId);
    if (!usage.plan) return { ok: false, error: "no_plan" };
    if (usage.dynamic.used >= usage.dynamic.limit) return { ok: false, error: "limit" };
    // HEY-117: assigned once, from NULL; a code that had a short link keeps it.
    const shortCode = await assignShortCode(tx, qrCodeId, newShortCode);
    await tx.update(schema.qrCode).set({ status: "active", isTrial: false }).where(eq(schema.qrCode.id, qrCodeId));
    return { ok: true, shortCode };
  });
}

/** Design 7.7 "Make it a static QR instead": an unpaid Dynamic draft (never live) becomes a static code. */
export async function convertToStatic(db: Db, userId: string, qrCodeId: string): Promise<{ ok: boolean }> {
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)),
  });
  if (!qr || qr.model !== "dynamic" || qr.shortCode || qr.status === "active") return { ok: false };
  await db.update(schema.qrCode).set({ model: "static", destination: null }).where(eq(schema.qrCode.id, qrCodeId));
  return { ok: true };
}
