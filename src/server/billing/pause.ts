import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { accountUsage, currentPlan } from "./allowances";
import { trialCovers, trialPhase } from "./trial";

/*
 * HEY-127 / QR-17.05: the owner pauses and resumes a live Dynamic code.
 * - Pause sets the code's `paused` status: its short link shows the public unavailable page (no destination, no scan),
 *   and a plan code's live slot is free at once (slots count active codes). The slug, its HEY-126 reservation, the
 *   destination, its history and the layouts are untouched; the destination can still be changed while paused.
 * - Resume turns the same short link back on, to the destination stored now. It applies the rules that let the code
 *   be live in the first place: the trial's test code while the trial runs or a plan is active; any other code under
 *   an active plan with a free live slot.
 * Both run in one transaction that locks the account row, then the code row (the order every activation uses), so a
 * resume and another activation of the same account can't both take the last slot.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same functions as the actions.
 */
type Db = NodePgDatabase<typeof schema>;

export type PauseResult = { ok: true } | { ok: false; error: "not_found" | "not_dynamic" | "not_live" };
export type ResumeResult =
  { ok: true; shortCode: string } | { ok: false; error: "not_found" | "not_dynamic" | "not_paused" | "no_plan" | "limit" };

async function lockOwnCode(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, qrCodeId: string) {
  const [owner] = await tx.select().from(schema.user).where(eq(schema.user.id, userId)).for("update");
  if (!owner) return undefined;
  const [qr] = await tx
    .select()
    .from(schema.qrCode)
    .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
    .for("update");
  return qr ? { owner, qr } : undefined;
}

/** Pauses the owner's issued, active Dynamic code. Pausing a paused code changes nothing. */
export async function pauseDynamicCode(db: Db, userId: string, qrCodeId: string): Promise<PauseResult> {
  return db.transaction(async (tx) => {
    const found = await lockOwnCode(tx, userId, qrCodeId);
    if (!found) return { ok: false, error: "not_found" } as const;
    const { qr } = found;
    if (qr.model !== "dynamic") return { ok: false, error: "not_dynamic" } as const;
    if (qr.status === "paused" && qr.shortCode) return { ok: true } as const;
    if (qr.status !== "active" || !qr.shortCode) return { ok: false, error: "not_live" } as const;
    await tx.update(schema.qrCode).set({ status: "paused" }).where(eq(schema.qrCode.id, qr.id));
    return { ok: true } as const;
  });
}

/** Resumes the owner's paused Dynamic code on its issued slug and current destination. Resuming a live code is a no-op. */
export async function resumeDynamicCode(db: Db, userId: string, qrCodeId: string, now: Date = new Date()): Promise<ResumeResult> {
  return db.transaction(async (tx) => {
    const found = await lockOwnCode(tx, userId, qrCodeId);
    if (!found) return { ok: false, error: "not_found" } as const;
    const { owner, qr } = found;
    if (qr.model !== "dynamic") return { ok: false, error: "not_dynamic" } as const;
    if (!qr.shortCode) return { ok: false, error: "not_paused" } as const;
    if (qr.status === "active") return { ok: true, shortCode: qr.shortCode } as const;
    if (qr.status !== "paused") return { ok: false, error: "not_paused" } as const;
    const plan = await currentPlan(tx as unknown as Db, userId);
    if (qr.isTrial) {
      // The trial's test code takes the trial's slot, not a plan slot (as when it was activated).
      if (!plan && !trialCovers(trialPhase(owner, false, now), qr)) return { ok: false, error: "no_plan" } as const;
    } else {
      if (!plan) return { ok: false, error: "no_plan" } as const;
      const usage = await accountUsage(tx as unknown as Db, userId);
      if (usage.dynamic.used >= usage.dynamic.limit) return { ok: false, error: "limit" } as const;
    }
    await tx.update(schema.qrCode).set({ status: "active" }).where(eq(schema.qrCode.id, qr.id));
    return { ok: true, shortCode: qr.shortCode } as const;
  });
}
