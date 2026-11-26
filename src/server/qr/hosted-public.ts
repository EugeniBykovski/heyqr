import { createHash } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { hostedAssetIds } from "../../entities/qr/model/hosted";
import { resolveShortLink } from "../billing/access";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import { reportFailure } from "../monitoring";
import type { LogoStore } from "./logo-assets";

/*
 * What anonymous visitors of a hosted page may read, and what they may send (design 11.0): the files of the live
 * published version, "Report this page", and the /developers "Email me" sign-up. Plain module: the PostgreSQL tests
 * run the same rules with a memory store.
 */
type Db = NodePgDatabase<typeof schema>;

export type PublicFile = { bytes: Uint8Array; contentType: string; byteSize: number };

/**
 * A file of a public hosted page: only while the short link is live (resolveShortLink: active, the plan or trial
 * covers it), only a file the latest published version refers to, and only the code owner's. Draft files, files of
 * older versions and other accounts' files are never served here, whatever id is asked for.
 */
export async function publicHostedFile(
  db: Db,
  store: LogoStore,
  shortCode: string,
  assetId: string,
  now: Date = new Date(),
): Promise<PublicFile | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shortCode) || !/^[A-Za-z0-9_-]{6,64}$/.test(assetId)) return null;
  const answer = await resolveShortLink(db, shortCode, now);
  if (answer.kind !== "hosted" || !hostedAssetIds(answer.page.content).includes(assetId)) return null;
  const [row] = await db
    .select({ key: schema.asset.storageKey, type: schema.asset.contentType, size: schema.asset.byteSize })
    .from(schema.asset)
    .innerJoin(schema.qrCode, eq(schema.qrCode.userId, schema.asset.userId))
    .where(and(eq(schema.asset.id, assetId), eq(schema.qrCode.id, answer.qrCodeId)));
  if (!row) return null;
  const bytes = await store.get(row.key).catch((error: unknown) => {
    reportFailure(error, { operation: "qr.hosted_file", severity: "high", route: "/p/[code]/a/[assetId]" });
    return null;
  });
  return bytes ? { bytes, contentType: row.type, byteSize: row.size } : null;
}

/** A draft file for its owner only (the editor preview of photos and the PDF before publishing). */
export async function ownerHostedFile(db: Db, store: LogoStore, userId: string, assetId: string): Promise<PublicFile | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(assetId)) return null;
  const [row] = await db
    .select({ key: schema.asset.storageKey, type: schema.asset.contentType, size: schema.asset.byteSize })
    .from(schema.asset)
    .where(and(eq(schema.asset.id, assetId), eq(schema.asset.userId, userId)));
  if (!row) return null;
  const bytes = await store.get(row.key).catch(() => null);
  return bytes ? { bytes, contentType: row.type, byteSize: row.size } : null;
}

/* ── Report this page ────────────────────────────────────────────────────────────────────────────────────────── */

export const REPORT_REASONS = ["scam", "malware", "illegal", "impersonation", "other"] as const;
/** Reports one visitor (by hashed address) may send per hour, across all pages. */
export const REPORTS_PER_HOUR = 5;

export const reportSchema = z.strictObject({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).default(""),
  email: z.union([z.literal(""), z.email().max(254)]).default(""),
});

export type ReportResult = { ok: true } | { ok: false; error: "invalid" | "not_found" | "rate_limited" };

/** sha256 of the visitor's address with a server secret: enough to limit repeats, without storing the address. */
export const reporterHash = (address: string, secret: string) => createHash("sha256").update(`${secret}:${address}`).digest("hex");

/**
 * Stores a report for review. The short link must exist (a deleted or paused page can still be reported while it
 * exists); the visitor is limited to REPORTS_PER_HOUR. Nothing on the page changes automatically.
 */
export async function submitReport(db: Db, raw: unknown, reporter: string, now: Date = new Date()): Promise<ReportResult> {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { code, reason, details, email } = parsed.data;
  const qr = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.shortCode, code), columns: { id: true } });
  if (!qr) return { ok: false, error: "not_found" };
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [recent] = await db
    .select({ n: count() })
    .from(schema.pageReport)
    .where(and(eq(schema.pageReport.reporterHash, reporter), gte(schema.pageReport.createdAt, hourAgo)));
  if ((recent?.n ?? 0) >= REPORTS_PER_HOUR) return { ok: false, error: "rate_limited" };
  const answer = await resolveShortLink(db, code, now);
  await db.insert(schema.pageReport).values({
    id: newId(),
    shortCode: code,
    qrCodeId: qr.id,
    version: answer.kind === "hosted" ? answer.page.version : null,
    reason,
    details,
    email: email || null,
    reporterHash: reporter,
    createdAt: now,
  });
  return { ok: true };
}

/* ── /developers "Email me" ──────────────────────────────────────────────────────────────────────────────────── */

/** Topics: "packages" (npm releases, design 12.2) and "rest" (the REST API waitlist, design 12.18–12.20). */
export const NOTIFY_TOPICS = ["packages", "rest"] as const;
export const notifySchema = z.strictObject({ email: z.email().max(254), topic: z.enum(NOTIFY_TOPICS) });

/** Adds the address to the release list; signing up twice is fine (one row per address and topic). */
export async function submitDeveloperNotify(db: Db, raw: unknown): Promise<{ ok: true } | { ok: false; error: "invalid" }> {
  const parsed = notifySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  await db
    .insert(schema.developerNotify)
    .values({ id: newId(), email: parsed.data.email.toLowerCase(), topic: parsed.data.topic })
    .onConflictDoNothing();
  return { ok: true };
}

/** For tests and support: the reports stored for a short link, newest first. */
export async function reportsFor(db: Db, shortCode: string) {
  return db
    .select()
    .from(schema.pageReport)
    .where(eq(schema.pageReport.shortCode, shortCode))
    .orderBy(sql`created_at desc`);
}

/* ── Docs "Was this page helpful?" ───────────────────────────────────────────────────────────────────────────── */

/** Stores one answer for a docs page. `pages`: the ids answers may name (public docs pages), so nothing else gets in. */
export async function submitDocFeedback(
  db: Db,
  raw: unknown,
  pages: readonly string[],
): Promise<{ ok: true } | { ok: false; error: "invalid" }> {
  const parsed = z.strictObject({ page: z.string().max(64), helpful: z.boolean() }).safeParse(raw);
  if (!parsed.success || !pages.includes(parsed.data.page)) return { ok: false, error: "invalid" };
  await db.insert(schema.docFeedback).values({ id: newId(), page: parsed.data.page, helpful: parsed.data.helpful });
  return { ok: true };
}
