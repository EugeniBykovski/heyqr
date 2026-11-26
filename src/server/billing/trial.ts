import { and, eq, isNull, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { publishOnFirstLive } from "../qr/hosted";
import { assignShortCode } from "../qr/short-code";

/*
 * Design 9.x "Starter trial" (Handoff · Commerce §1): 7 days, no card and no automatic charge, one test Dynamic QR with a
 * real short link. When the trial ends without a plan the test code's redirect pauses ("link paused"); nothing is
 * deleted, and taking the Dynamic plan turns the same short link back on. The server decides all of it.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same functions as the actions and the redirect.
 */
export const TRIAL_DAYS = 7;
const DAY_MS = 86_400_000;

export type TrialPhase =
  | { state: "none"; eligible: boolean }
  | { state: "active" | "ending"; day: number; daysLeft: number; startedAt: Date; endsAt: Date }
  | { state: "expired"; startedAt: Date; endsAt: Date }
  | { state: "upgraded"; startedAt: Date; endsAt: Date };

/** The trial as the user sees it. "ending": less than a day left. A plan after a trial is "upgraded". */
export function trialPhase(
  user: { trialStartedAt: Date | null; trialEndsAt: Date | null },
  subscribed: boolean,
  now: Date = new Date(),
): TrialPhase {
  const { trialStartedAt: startedAt, trialEndsAt: endsAt } = user;
  if (!startedAt || !endsAt) return { state: "none", eligible: !subscribed };
  if (subscribed) return { state: "upgraded", startedAt, endsAt };
  const left = endsAt.getTime() - now.getTime();
  if (left <= 0) return { state: "expired", startedAt, endsAt };
  const daysLeft = Math.ceil(left / DAY_MS);
  const day = Math.min(TRIAL_DAYS, Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS) + 1);
  return { state: left <= DAY_MS ? "ending" : "active", day, daysLeft, startedAt, endsAt };
}

/** Whether the trial lets this code redirect and download now: the trial's test code, while the trial runs. */
export const trialCovers = (phase: TrialPhase, qr: { isTrial: boolean }) =>
  qr.isTrial && (phase.state === "active" || phase.state === "ending");

export type StartTrialResult = { ok: true; endsAt: Date } | { ok: false; error: "already_used" | "subscribed" };

/** Starts the trial once per account, never on an account that already has the Dynamic plan. */
export async function startTrial(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  subscribed: boolean,
  now: Date = new Date(),
): Promise<StartTrialResult> {
  if (subscribed) return { ok: false, error: "subscribed" };
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  const updated = await db
    .update(schema.user)
    .set({ trialStartedAt: now, trialEndsAt: endsAt })
    .where(and(eq(schema.user.id, userId), isNull(schema.user.trialStartedAt)))
    .returning({ id: schema.user.id });
  return updated.length ? { ok: true, endsAt } : { ok: false, error: "already_used" };
}

export type ActivateTrialCodeResult =
  { ok: true; shortCode: string } | { ok: false; error: "not_found" | "not_dynamic" | "no_trial" | "slot_taken" };

/**
 * Uses the trial's one Dynamic slot for this code: it gets its permanent short link and goes live. Only while the trial
 * runs, only the owner's own dynamic code, and only one live test code at a time (a deleted test code frees the slot).
 */
export async function activateTrialCode(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  qrCodeId: string,
  newShortCode: () => string,
  now: Date = new Date(),
): Promise<ActivateTrialCodeResult> {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select().from(schema.user).where(eq(schema.user.id, userId)).for("update");
    if (!owner) return { ok: false, error: "not_found" } as const;
    const phase = trialPhase(owner, false, now);
    if (phase.state !== "active" && phase.state !== "ending") return { ok: false, error: "no_trial" } as const;
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (qr.model !== "dynamic") return { ok: false, error: "not_dynamic" } as const;
    if (qr.isTrial && qr.shortCode) return { ok: true, shortCode: qr.shortCode } as const;
    const [other] = await tx
      .select({ id: schema.qrCode.id })
      .from(schema.qrCode)
      .where(
        and(
          eq(schema.qrCode.userId, userId),
          eq(schema.qrCode.isTrial, true),
          isNull(schema.qrCode.deletedAt),
          ne(schema.qrCode.id, qr.id),
        ),
      );
    if (other) return { ok: false, error: "slot_taken" } as const;
    // HEY-117: assigned once, from NULL; a code that had a short link keeps it.
    const shortCode = await assignShortCode(tx, qr.id, newShortCode);
    await tx.update(schema.qrCode).set({ status: "active", isTrial: true }).where(eq(schema.qrCode.id, qr.id));
    // HEY-182: a hosted page goes live with its page published (first time only).
    await publishOnFirstLive(tx, userId, qr.id, now);
    return { ok: true, shortCode } as const;
  });
}

/** The trial's test code, if any (live or paused, not deleted). */
export async function trialCode(db: NodePgDatabase<typeof schema>, userId: string) {
  return db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.userId, userId), eq(schema.qrCode.isTrial, true), isNull(schema.qrCode.deletedAt)),
    with: { layouts: true },
  });
}
