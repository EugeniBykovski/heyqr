import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/**
 * HEY-145: one scan of a code, added to its daily counter (scan_daily) in a single statement. The insert-or-increment
 * is atomic in PostgreSQL (the conflicting row is locked and re-read), so concurrent scans of the same code and day
 * never lose an increment, including the first scan of a day. Plain module so the PostgreSQL tests run this statement.
 */
export async function incrementScan(
  db: NodePgDatabase<typeof schema>,
  qrCodeId: string,
  day: string = new Date().toISOString().slice(0, 10),
) {
  await db
    .insert(schema.scanDaily)
    .values({ qrCodeId, day, count: 1 })
    .onConflictDoUpdate({ target: [schema.scanDaily.qrCodeId, schema.scanDaily.day], set: { count: sql`${schema.scanDaily.count} + 1` } });
}
