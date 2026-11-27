import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accountUsage } from "../billing/allowances";
import * as schema from "../db/schema";

/** The Undo toast's duration (design 4.12: "a toast offers Undo for 8 seconds"). */
export const UNDO_TOAST_MS = 8_000;
/**
 * HEY-199: how long after a delete the server still accepts its Undo. Undo is only offered by the 8-second toast; the
 * window adds room for a slow network or a request still in flight when the toast closes, and no more, so a stale tab
 * can't bring codes back minutes later.
 */
export const RESTORE_WINDOW_MS = 30_000;
export const MAX_DELETE_BATCH = 100;

type Db = NodePgDatabase<typeof schema>;

/**
 * Soft-deletes the owner's codes: they leave My QR codes, details and export, and a dynamic code's short link stops
 * redirecting at once. Only rows owned by `userId` are touched. Returns the ids that were deleted.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same path as the action.
 */
export async function softDeleteQrCodes(db: Db, userId: string, ids: string[], now = new Date()) {
  if (ids.length === 0) return [];
  const rows = await db
    .update(schema.qrCode)
    // Keep updated_at: deleting or restoring isn't an edit, so Undo puts the code back in its place.
    .set({ deletedAt: now, updatedAt: sql`${schema.qrCode.updatedAt}` })
    .where(and(inArray(schema.qrCode.id, ids), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
    .returning({ id: schema.qrCode.id });
  return rows.map((r) => r.id);
}

export type RestoreResult =
  | { ok: true; ids: string[] }
  /** not_found: an id isn't the owner's. expired: past RESTORE_WINDOW_MS. limit: live Dynamic slots are taken. */
  | { ok: false; error: "not_found" | "expired" | "limit" };

/**
 * Undo: brings back the owner's codes deleted within RESTORE_WINDOW_MS, all of them or none (HEY-199).
 * - Locks the account row, then the code rows, like activateDynamicCode (HEY-135), so an Undo and an activation that
 *   both want the last live Dynamic slot run one after the other and the plan limit holds.
 * - A live Dynamic code takes its slot back; when the slots have been used since, nothing is restored ("limit").
 * - Codes already restored count as restored, so a repeated request (double click, retry) is safe.
 * - Records, layouts and short links were never removed, and updated_at is kept, so codes return to their places.
 */
export async function restoreQrCodes(db: Db, userId: string, ids: string[], now = new Date()): Promise<RestoreResult> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return { ok: false, error: "not_found" };
  return db.transaction(async (tx) => {
    await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
    const rows = await tx
      .select({
        id: schema.qrCode.id,
        deletedAt: schema.qrCode.deletedAt,
        model: schema.qrCode.model,
        status: schema.qrCode.status,
        isTrial: schema.qrCode.isTrial,
      })
      .from(schema.qrCode)
      .where(and(inArray(schema.qrCode.id, wanted), eq(schema.qrCode.userId, userId)))
      .orderBy(asc(schema.qrCode.id))
      .for("update");
    if (rows.length !== wanted.length) return { ok: false, error: "not_found" };
    const deleted = rows.filter((r) => r.deletedAt !== null);
    if (deleted.length === 0) return { ok: true, ids: wanted };
    if (deleted.some((r) => r.deletedAt && now.getTime() - r.deletedAt.getTime() > RESTORE_WINDOW_MS))
      return { ok: false, error: "expired" };
    // Only a live, plan-held Dynamic code takes a slot (trial codes and drafts don't). Without a plan nothing counts:
    // its link shows "not active" until a plan starts, and Reactivate brings it back (HEY-185).
    const reclaim = deleted.filter((r) => r.model === "dynamic" && r.status === "active" && !r.isTrial).length;
    if (reclaim > 0) {
      const usage = await accountUsage(tx as unknown as Db, userId, now);
      if (usage.plan && usage.dynamic.used + reclaim > usage.dynamic.limit) return { ok: false, error: "limit" };
    }
    await tx
      .update(schema.qrCode)
      .set({ deletedAt: null, updatedAt: sql`${schema.qrCode.updatedAt}` })
      .where(
        and(
          inArray(
            schema.qrCode.id,
            deleted.map((r) => r.id),
          ),
          eq(schema.qrCode.userId, userId),
        ),
      );
    return { ok: true, ids: wanted };
  });
}
