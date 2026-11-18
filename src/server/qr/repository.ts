import "server-only";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { readLayoutRecord } from "@/entities/qr";
import { db, schema } from "../db";

/**
 * Read boundary for qr_layout.design: legacy records are upgraded in memory, unreadable ones (malformed or from a
 * newer schemaVersion) are left out and logged by id, never shown with a wrong design.
 */
function readable<T extends { id: string; design: unknown }>(layouts: T[]): T[] {
  return layouts.flatMap((l) => {
    const read = readLayoutRecord(l.design);
    if (read.ok) return [{ ...l, design: read.value }];
    console.error(
      `[qr] skipped layout ${l.id}: ${read.reason} design record${read.version === undefined ? "" : ` (schemaVersion ${String(read.version)})`}`,
    );
    return [];
  });
}

export async function listQrCodes(userId: string) {
  const codes = await db.query.qrCode.findMany({
    where: and(eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)),
    orderBy: desc(schema.qrCode.updatedAt),
    with: { layouts: { orderBy: asc(schema.qrLayout.sortOrder), limit: 1 } },
  });
  return codes.map((qr) => ({ ...qr, layouts: readable(qr.layouts) }));
}

export async function getQrCode(userId: string, id: string) {
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, id), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)),
    with: { layouts: { orderBy: asc(schema.qrLayout.sortOrder) } },
  });
  return qr && { ...qr, layouts: readable(qr.layouts) };
}

export async function getLayoutWithQr(layoutId: string) {
  const record = await db.query.qrLayout.findFirst({ where: eq(schema.qrLayout.id, layoutId), with: { qrCode: true } });
  // A deleted code can't be exported, even by its owner.
  return record && !record.qrCode.deletedAt ? readable([record])[0] : undefined;
}

/** Daily scans for the last `days` days, zero-filled, oldest first. */
export async function dailyScans(qrCodeId: string, days = 14) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ day: schema.scanDaily.day, count: schema.scanDaily.count })
    .from(schema.scanDaily)
    .where(and(eq(schema.scanDaily.qrCodeId, qrCodeId), gte(schema.scanDaily.day, since)));
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, count: byDay.get(day) ?? 0 };
  });
}

export async function recordScan(qrCodeId: string) {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(schema.scanDaily)
    .values({ qrCodeId, day, count: 1 })
    .onConflictDoUpdate({ target: [schema.scanDaily.qrCodeId, schema.scanDaily.day], set: { count: sql`${schema.scanDaily.count} + 1` } });
}
