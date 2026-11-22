import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/**
 * HEY-80: renames one of the owner's codes. Only the name changes: content, short link, layouts and purchase stay as
 * they are, and a rename never counts as a new draft. Another account's code, or a deleted one, is "not_found".
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same write as the renameQr action.
 */
export async function renameQrCode(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  qrCodeId: string,
  name: string,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "not_found" }> {
  const value = name.trim();
  if (value.length < 1 || value.length > 80) return { ok: false, error: "invalid" };
  const updated = await db
    .update(schema.qrCode)
    .set({ name: value })
    .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
    .returning({ id: schema.qrCode.id });
  return updated.length ? { ok: true } : { ok: false, error: "not_found" };
}
