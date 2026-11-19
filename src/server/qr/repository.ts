import "server-only";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { pickLayoutForEdit, readLayoutRecord } from "@/entities/qr";
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

/**
 * Edit design (HEY-45): the owner's existing code and one of its layouts: the given one, or the first by order (the one
 * My QR codes shows). Null when the code isn't the user's, is deleted, or has no such layout.
 */
export async function getLayoutForEdit(userId: string, qrCodeId: string, layoutId?: string) {
  const qr = await getQrCode(userId, qrCodeId);
  if (!qr) return null;
  const layout = pickLayoutForEdit(qr.layouts, layoutId);
  return layout ? { qr, layout } : null;
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

/**
 * Signed-in home ("Your studio"): the owner's live codes, scans per day across their dynamic codes for the last
 * `days` days (zero-filled, oldest first), 14-day scans per code, and how many paid layouts can be downloaded.
 */
export async function studioSummary(userId: string, days = 14) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const owned = and(eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt));
  const [codes, perDay, perCode, [files], layoutCounts] = await Promise.all([
    listQrCodes(userId),
    db
      .select({ day: schema.scanDaily.day, count: sql<number>`sum(${schema.scanDaily.count})::int` })
      .from(schema.scanDaily)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
      .where(and(owned, gte(schema.scanDaily.day, since)))
      .groupBy(schema.scanDaily.day),
    db
      .select({
        qrCodeId: schema.scanDaily.qrCodeId,
        count: sql<number>`sum(${schema.scanDaily.count})::int`,
        today: sql<number>`sum(case when ${schema.scanDaily.day} = ${today} then ${schema.scanDaily.count} else 0 end)::int`,
      })
      .from(schema.scanDaily)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
      .where(and(owned, gte(schema.scanDaily.day, since)))
      .groupBy(schema.scanDaily.qrCodeId),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.qrLayout)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.qrLayout.qrCodeId))
      .where(
        and(
          owned,
          sql`(${schema.qrCode.model} = 'static' and ${schema.qrCode.purchasedAt} is not null) or (${schema.qrCode.model} = 'dynamic' and ${schema.qrCode.status} = 'active')`,
        ),
      ),
    db
      .select({ qrCodeId: schema.qrLayout.qrCodeId, count: sql<number>`count(*)::int` })
      .from(schema.qrLayout)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.qrLayout.qrCodeId))
      .where(owned)
      .groupBy(schema.qrLayout.qrCodeId),
  ]);
  const byDay = new Map(perDay.map((r) => [r.day, r.count]));
  const scans = Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, count: byDay.get(day) ?? 0 };
  });
  return {
    codes,
    scans,
    scansByCode: new Map(perCode.map((r) => [r.qrCodeId, { total: r.count, today: r.today }])),
    filesReady: files?.count ?? 0,
    layoutsByCode: new Map(layoutCounts.map((r) => [r.qrCodeId, r.count])),
  };
}
