import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;

/**
 * HEY-198 "Files ready": the layouts this account can download now: of bought static codes and of active Dynamic
 * codes. Owner-scoped as a whole: `or` is its own group, so no other account's layouts are counted.
 */
export async function filesReadyCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.qrLayout)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.qrLayout.qrCodeId))
    .where(
      and(
        eq(schema.qrCode.userId, userId),
        isNull(schema.qrCode.deletedAt),
        or(
          and(eq(schema.qrCode.model, "static"), isNotNull(schema.qrCode.purchasedAt)),
          and(eq(schema.qrCode.model, "dynamic"), eq(schema.qrCode.status, "active")),
        ),
      ),
    );
  return row?.count ?? 0;
}

/** The account's first day with a recorded scan (YYYY-MM-DD), for week-over-week comparability; null without scans. */
export async function firstScanDay(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ day: sql<string | null>`min(${schema.scanDaily.day})::text` })
    .from(schema.scanDaily)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.scanDaily.qrCodeId))
    .where(and(eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)));
  return row?.day ?? null;
}
