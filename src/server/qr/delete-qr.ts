import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/** How long a deleted code can be brought back with Undo. The toast offers it for a few seconds; this is the server's limit. */
export const RESTORE_WINDOW_MS = 10 * 60_000;
export const MAX_DELETE_BATCH = 100;

/**
 * Soft-deletes the owner's codes: they leave My QR codes, details and export, and a dynamic code's short link stops
 * redirecting at once. Only rows owned by `userId` are touched. Returns the ids that were deleted.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same path as the action.
 */
export async function softDeleteQrCodes(db: NodePgDatabase<typeof schema>, userId: string, ids: string[], now = new Date()) {
  if (ids.length === 0) return [];
  const rows = await db
    .update(schema.qrCode)
    // Keep updated_at: deleting or restoring isn't an edit, so Undo puts the code back in its place.
    .set({ deletedAt: now, updatedAt: sql`${schema.qrCode.updatedAt}` })
    .where(and(inArray(schema.qrCode.id, ids), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
    .returning({ id: schema.qrCode.id });
  return rows.map((r) => r.id);
}

/** Undo: brings back the owner's codes deleted within RESTORE_WINDOW_MS. Returns the ids that were restored. */
export async function restoreQrCodes(db: NodePgDatabase<typeof schema>, userId: string, ids: string[], now = new Date()) {
  if (ids.length === 0) return [];
  const rows = await db
    .update(schema.qrCode)
    .set({ deletedAt: null, updatedAt: sql`${schema.qrCode.updatedAt}` })
    .where(
      and(
        inArray(schema.qrCode.id, ids),
        eq(schema.qrCode.userId, userId),
        isNotNull(schema.qrCode.deletedAt),
        gte(schema.qrCode.deletedAt, new Date(now.getTime() - RESTORE_WINDOW_MS)),
      ),
    )
    .returning({ id: schema.qrCode.id });
  return rows.map((r) => r.id);
}
