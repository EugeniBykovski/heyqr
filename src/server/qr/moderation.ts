import { and, count, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { REPORT_REASONS } from "./hosted-public";

/*
 * HEY-182 moderation (design 11.0 / developer handoff "Report this page → moderation queue → Unavailable").
 *
 * Visitors' reports are stored (hosted-public.ts submitReport); nothing changes on the page automatically. An operator
 * reviews the queue and takes a code down: its short link, its hosted page and the page's files then answer
 * "unavailable" (resolveShortLink), whatever the owner does with Resume or Publish. Restoring clears the takedown and
 * the code answers as before. Neither touches the owner's content, versions, short link or scans.
 *
 * Plain module (no "server-only"): the operator script and the PostgreSQL tests run it.
 */
type Db = NodePgDatabase<typeof schema>;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The queue: reported short links not taken down, most reports first, with the latest report's time. */
export async function moderationQueue(db: Db) {
  return db
    .select({
      shortCode: schema.pageReport.shortCode,
      reports: count(),
      latest: max(schema.pageReport.createdAt),
      reasons: sql<string[]>`array_agg(distinct ${schema.pageReport.reason})`,
    })
    .from(schema.pageReport)
    .innerJoin(schema.qrCode, eq(schema.qrCode.shortCode, schema.pageReport.shortCode))
    .where(and(isNull(schema.qrCode.takenDownAt), isNull(schema.qrCode.deletedAt)))
    .groupBy(schema.pageReport.shortCode)
    .orderBy(desc(count()), desc(max(schema.pageReport.createdAt)));
}

export type TakedownResult = { ok: true; qrCodeId: string; already: boolean } | { ok: false; error: "not_found" | "invalid" };

/** Takes a short link down after a report. Repeating it keeps the first takedown's time and reason. */
export async function takeDown(db: Db, shortCode: string, reason: string, now: Date = new Date()): Promise<TakedownResult> {
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "invalid" };
  const [qr] = await db
    .select({ id: schema.qrCode.id, takenDownAt: schema.qrCode.takenDownAt })
    .from(schema.qrCode)
    .where(eq(schema.qrCode.shortCode, shortCode));
  if (!qr) return { ok: false, error: "not_found" };
  if (qr.takenDownAt) return { ok: true, qrCodeId: qr.id, already: true };
  await db
    .update(schema.qrCode)
    .set({ takenDownAt: now, takedownReason: reason })
    .where(and(eq(schema.qrCode.id, qr.id), isNull(schema.qrCode.takenDownAt)));
  return { ok: true, qrCodeId: qr.id, already: false };
}

/** Lifts a takedown (the review found nothing wrong): the code answers as its status and plan allow again. */
export async function restoreTakenDown(db: Db, shortCode: string): Promise<{ ok: boolean }> {
  const rows = await db
    .update(schema.qrCode)
    .set({ takenDownAt: null, takedownReason: null })
    .where(and(eq(schema.qrCode.shortCode, shortCode), isNotNull(schema.qrCode.takenDownAt)))
    .returning({ id: schema.qrCode.id });
  return { ok: rows.length > 0 };
}
