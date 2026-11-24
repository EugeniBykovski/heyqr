import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/**
 * HEY-145: one scan of a code, added to its daily counter (scan_daily) in a single statement. The insert-or-increment
 * is atomic in PostgreSQL (the conflicting row is locked and re-read), so concurrent scans of the same code and day
 * never lose an increment, including the first scan of a day. Plain module so the PostgreSQL tests run this statement.
 */
/** HEY-147: the UTC calendar day a moment falls on (YYYY-MM-DD): the key of every daily counter and report day. */
export const utcDay = (moment: Date) => moment.toISOString().slice(0, 10);

export async function incrementScan(db: NodePgDatabase<typeof schema>, qrCodeId: string, day: string = utcDay(new Date())) {
  await db
    .insert(schema.scanDaily)
    .values({ qrCodeId, day, count: 1 })
    .onConflictDoUpdate({ target: [schema.scanDaily.qrCodeId, schema.scanDaily.day], set: { count: sql`${schema.scanDaily.count} + 1` } });
}

/** HEY-146: the header that marks a request as test traffic (QA scripts, monitors, support checks): never counted. */
export const TEST_TRAFFIC_HEADER = "x-heyqr-test";

/**
 * HEY-146: whether a request to /r/<code> is a scan worth counting. Only the request's method and these explicit
 * signals are read, and nothing about the request is stored (no IP, user agent, cookie or referrer):
 * - only GET counts: HEAD (link checkers, uptime probes) and anything else never does;
 * - browser prefetch / prerender (Sec-Purpose, Purpose, X-Purpose, X-Moz) isn't a scan;
 * - test traffic marked with the x-heyqr-test header isn't a scan.
 * Every one of them still gets the same redirect; this decides the counter only.
 */
export function isCountableScan(method: string, headers: Pick<Headers, "get">): boolean {
  if (method.toUpperCase() !== "GET") return false;
  const purpose = ["sec-purpose", "purpose", "x-purpose", "x-moz"]
    .map((h) => headers.get(h) ?? "")
    .join(" ")
    .toLowerCase();
  if (/prefetch|prerender|preview/.test(purpose)) return false;
  const test = headers.get(TEST_TRAFFIC_HEADER);
  return !(test !== null && test !== "" && test !== "0");
}

/**
 * The owner-facing report: one code's scans per day for the last `days` days (zero-filled, oldest first), only when the
 * code is the signed-in owner's. Counts only: day and number, nothing else.
 */
export async function scansByDay(db: NodePgDatabase<typeof schema>, userId: string, qrCodeId: string, days = 14, now: Date = new Date()) {
  // HEY-147: one reading of the clock for the whole report, so it can't straddle UTC midnight.
  const dayOf = (back: number) => utcDay(new Date(now.getTime() - back * 86_400_000));
  const since = dayOf(days - 1);
  const rows = await db
    .select({ day: schema.scanDaily.day, count: schema.scanDaily.count })
    .from(schema.scanDaily)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
    .where(and(eq(schema.scanDaily.qrCodeId, qrCodeId), eq(schema.qrCode.userId, userId), gte(schema.scanDaily.day, since)));
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  return Array.from({ length: days }, (_, i) => {
    const day = dayOf(days - 1 - i);
    return { day, count: byDay.get(day) ?? 0 };
  });
}

/** HEY-148: whether the owner's code has ever been scanned (any day): tells "no scans yet" from "none this period". */
export async function hasScans(db: NodePgDatabase<typeof schema>, userId: string, qrCodeId: string) {
  const [row] = await db
    .select({ day: schema.scanDaily.day })
    .from(schema.scanDaily)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
    .where(and(eq(schema.scanDaily.qrCodeId, qrCodeId), eq(schema.qrCode.userId, userId), sql`${schema.scanDaily.count} > 0`))
    .limit(1);
  return Boolean(row);
}

/**
 * HEY-148: the home summary's scans (HEY-198) under the same convention as QR details: UTC days, one reading of the
 * clock, the last `days` days ending today. Across the owner's codes per day (zero-filled, oldest first), and per code
 * its total for the period and today's count. Deleted codes are left out.
 */
export async function ownerScanSummary(db: NodePgDatabase<typeof schema>, userId: string, days = 14, now: Date = new Date()) {
  const dayOf = (back: number) => utcDay(new Date(now.getTime() - back * 86_400_000));
  const since = dayOf(days - 1);
  const today = dayOf(0);
  const owned = and(eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt), gte(schema.scanDaily.day, since));
  const [perDay, perCode] = await Promise.all([
    db
      .select({ day: schema.scanDaily.day, count: sql<number>`sum(${schema.scanDaily.count})::int` })
      .from(schema.scanDaily)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
      .where(owned)
      .groupBy(schema.scanDaily.day),
    db
      .select({
        qrCodeId: schema.scanDaily.qrCodeId,
        count: sql<number>`sum(${schema.scanDaily.count})::int`,
        today: sql<number>`sum(case when ${schema.scanDaily.day} = ${today} then ${schema.scanDaily.count} else 0 end)::int`,
      })
      .from(schema.scanDaily)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
      .where(owned)
      .groupBy(schema.scanDaily.qrCodeId),
  ]);
  const byDay = new Map(perDay.map((r) => [r.day, r.count]));
  return {
    scans: Array.from({ length: days }, (_, i) => {
      const day = dayOf(days - 1 - i);
      return { day, count: byDay.get(day) ?? 0 };
    }),
    scansByCode: new Map(perCode.map((r) => [r.qrCodeId, { total: r.count, today: r.today }])),
  };
}
