import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { pickLayoutForEdit, readLayoutRecord } from "@/entities/qr";
import { db, schema } from "../db";
import { logoStore } from "../storage/s3";
import { resolveLogos } from "./logo-assets";
import { hasScans, incrementScan, ownerScanSummary, scansByDay } from "./scans";
import { filesReadyCount, firstScanDay } from "./studio-files";
import { layoutRevision } from "./update-layout";

/**
 * Read boundary for qr_layout.design: legacy records are upgraded in memory, unreadable ones (malformed or from a
 * newer schemaVersion) are left out and logged by id, never shown with a wrong design.
 */
function readableOnly<T extends { id: string; design: unknown }>(layouts: T[]) {
  return layouts.flatMap((l) => {
    const read = readLayoutRecord(l.design);
    if (read.ok) return [{ ...l, design: read.value }];
    console.error(
      `[qr] skipped layout ${l.id}: ${read.reason} design record${read.version === undefined ? "" : ` (schemaVersion ${String(read.version)})`}`,
    );
    return [];
  });
}

/**
 * HEY-83: the readable layouts of a code owned by `ownerId`, with their stored logos resolved from private storage for
 * that owner only (a reference to anyone else's file is dropped). Every page and route reads layouts through here.
 */
export async function readable<T extends { id: string; design: unknown }>(ownerId: string, layouts: T[]) {
  const ok = readableOnly(layouts);
  const store = logoStore();
  if (!store) return ok;
  const designs = await resolveLogos(
    db,
    store,
    ownerId,
    ok.map((l) => l.design),
  );
  return ok.map((l, i) => ({ ...l, design: designs[i] ?? l.design }));
}

export async function listQrCodes(userId: string) {
  const codes = await db.query.qrCode.findMany({
    where: and(eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)),
    orderBy: desc(schema.qrCode.updatedAt),
    with: { layouts: { orderBy: asc(schema.qrLayout.sortOrder), limit: 1 } },
  });
  return Promise.all(codes.map(async (qr) => ({ ...qr, layouts: await readable(userId, qr.layouts) })));
}

export async function getQrCode(userId: string, id: string) {
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, id), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)),
    with: { layouts: { orderBy: asc(schema.qrLayout.sortOrder) } },
  });
  return qr && { ...qr, layouts: await readable(userId, qr.layouts) };
}

/**
 * Edit design (HEY-45): the owner's existing code and one of its layouts: the given one, or the first by order (the one
 * My QR codes shows). Null when the code isn't the user's, is deleted, or has no such layout.
 */
export async function getLayoutForEdit(userId: string, qrCodeId: string, layoutId?: string) {
  const qr = await getQrCode(userId, qrCodeId);
  if (!qr) return null;
  const layout = pickLayoutForEdit(qr.layouts, layoutId);
  if (!layout) return null;
  // HEY-85: the version this editor opens, sent back with the save (a newer save in between is a conflict).
  const [row] = await db.select({ revision: layoutRevision }).from(schema.qrLayout).where(eq(schema.qrLayout.id, layout.id));
  return row ? { qr, layout, revision: row.revision } : null;
}

/** The paid purchase of a static code, for its receipt (amount as Stripe charged it, tax included). */
export async function paidPurchase(userId: string, qrCodeId: string) {
  return db.query.purchase.findFirst({
    where: and(eq(schema.purchase.userId, userId), eq(schema.purchase.qrCodeId, qrCodeId), eq(schema.purchase.status, "paid")),
    orderBy: desc(schema.purchase.paidAt),
  });
}

export async function getLayoutWithQr(layoutId: string) {
  const record = await db.query.qrLayout.findFirst({ where: eq(schema.qrLayout.id, layoutId), with: { qrCode: true } });
  // A deleted code can't be exported, even by its owner.
  return record && !record.qrCode.deletedAt ? (await readable(record.qrCode.userId, [record]))[0] : undefined;
}

/** Daily scans for the last `days` days, zero-filled, oldest first. */
/** HEY-146: one of the owner's codes, its scans per day (scans.ts scansByDay); another account's code reads as zeros. */
export const dailyScans = (userId: string, qrCodeId: string, days = 14) => scansByDay(db, userId, qrCodeId, days);

/** HEY-148: whether the owner's code was ever scanned (scans.ts hasScans). */
export const everScanned = (userId: string, qrCodeId: string) => hasScans(db, userId, qrCodeId);

/** One scan of a code on the app's database (scans.ts incrementScan). */
export async function recordScan(qrCodeId: string) {
  await incrementScan(db, qrCodeId);
}

/**
 * Signed-in home ("Your studio"): the owner's live codes, scans per day across their dynamic codes for the last
 * `days` days (zero-filled, oldest first), 14-day scans per code, and how many paid layouts can be downloaded.
 */
export async function studioSummary(userId: string, days = 14) {
  const owned = and(eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt));
  // HEY-148: scans under the same UTC-day convention as QR details (scans.ts ownerScanSummary).
  const [codes, { scans, scansByCode }, filesReady, layoutCounts, first] = await Promise.all([
    listQrCodes(userId),
    ownerScanSummary(db, userId, days),
    // HEY-198: owner-scoped as a whole (it used to count every account's active Dynamic layouts too).
    filesReadyCount(db, userId),
    db
      .select({ qrCodeId: schema.qrLayout.qrCodeId, count: sql<number>`count(*)::int` })
      .from(schema.qrLayout)
      .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.qrLayout.qrCodeId))
      .where(owned)
      .groupBy(schema.qrLayout.qrCodeId),
    // HEY-198: how far back the account's scan history goes (week-over-week needs both weeks inside it).
    firstScanDay(db, userId),
  ]);
  return {
    codes,
    scans,
    scansByCode,
    filesReady,
    firstScanDay: first,
    layoutsByCode: new Map(layoutCounts.map((r) => [r.qrCodeId, r.count])),
  };
}
