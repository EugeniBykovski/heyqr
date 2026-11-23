import { parseWebsiteUrl, type WebsiteUrlProblem } from "@heyqr/qr-core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/** HEY-119: why a destination was refused (the field error shown next to it). */
export type DestinationRefusal = { ok: false; error: "invalid"; field: "destination"; problem: WebsiteUrlProblem };

/**
 * HEY-119 / QR-16.04: the one server-side check for a Dynamic code's destination, on create and on every change. It is
 * the editor's own parser (qr-core parseWebsiteUrl):
 * - an explicit http:// or https:// is kept, with path, query and fragment;
 * - a bare domain becomes https://;
 * - blank input, spaces, other schemes, credentials and hosts without a dot are refused.
 */
export function parseDestination(raw: unknown): { ok: true; url: string } | DestinationRefusal {
  if (typeof raw !== "string" || raw.length > 2048) return { ok: false, error: "invalid", field: "destination", problem: "invalid" };
  const parsed = parseWebsiteUrl(raw);
  return parsed.ok ? parsed : { ok: false, error: "invalid", field: "destination", problem: parsed.problem };
}

/** HEY-123: the destination as stored, with the most recent change (previous URL and when; null when not known). */
export type DestinationState = { destination: string; previousDestination: string | null; changedAt: string | null };

/**
 * Design 4.4–4.6 Change destination, for the owner's Dynamic code only. Only the destination, the previous one and the
 * change time change (HEY-123: the time is the database's, set in the same write); the short link (HEY-117) and
 * everything else stay. HEY-125: the change is also recorded in destination_change, in the same transaction and under
 * the same row lock, with the same time, so the published destination, its last change and the history never diverge. A refused address, or the address already stored, writes nothing and keeps the previous URL
 * and time. Returns what is stored. Plain module (no "server-only") so the PostgreSQL tests exercise the same path as
 * the action.
 */
export async function changeDestination(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  qrCodeId: string,
  raw: unknown,
): Promise<{ ok: true; data: DestinationState } | DestinationRefusal | { ok: false; error: "not_found" }> {
  const parsed = parseDestination(raw);
  if (!parsed.ok) return parsed;
  const state = (row: { destination: string | null; previousDestination: string | null; destinationChangedAt: Date | null }) => ({
    destination: row.destination ?? "",
    previousDestination: row.previousDestination,
    changedAt: row.destinationChangedAt?.toISOString() ?? null,
  });
  const columns = {
    destination: schema.qrCode.destination,
    previousDestination: schema.qrCode.previousDestination,
    destinationChangedAt: schema.qrCode.destinationChangedAt,
  };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ model: schema.qrCode.model, ...columns })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr || qr.model !== "dynamic") return { ok: false, error: "not_found" } as const;
    if (qr.destination === parsed.url) return { ok: true, data: state(qr) } as const;
    const [saved] = await tx
      .update(schema.qrCode)
      .set({ destination: parsed.url, previousDestination: qr.destination, destinationChangedAt: sql`now()` })
      .where(eq(schema.qrCode.id, qrCodeId))
      .returning(columns);
    if (!saved) return { ok: false, error: "not_found" } as const;
    // now() is the transaction's start time: the entry's time equals destination_changed_at.
    await tx.insert(schema.destinationChange).values({ qrCodeId, previousUrl: qr.destination, newUrl: parsed.url, changedAt: sql`now()` });
    return { ok: true, data: state(saved) } as const;
  });
}

/** HEY-125: one recorded destination change, as QR details shows it. */
export type DestinationChangeEntry = { id: number; previousUrl: string | null; newUrl: string; changedAt: string };

/** How many changes QR details lists (most recent first). */
export const DESTINATION_HISTORY_LIMIT = 50;

/**
 * HEY-125: the owner's Dynamic code's recorded destination changes, most recent first (ties by insertion order). Another
 * account, or a deleted code, gets an empty list. Changes from before the history existed aren't invented: only those
 * recorded since are listed.
 */
export async function destinationHistory(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  qrCodeId: string,
  limit: number = DESTINATION_HISTORY_LIMIT,
): Promise<DestinationChangeEntry[]> {
  const rows = await db
    .select({
      id: schema.destinationChange.id,
      previousUrl: schema.destinationChange.previousUrl,
      newUrl: schema.destinationChange.newUrl,
      changedAt: schema.destinationChange.changedAt,
    })
    .from(schema.destinationChange)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.destinationChange.qrCodeId))
    .where(and(eq(schema.destinationChange.qrCodeId, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
    .orderBy(desc(schema.destinationChange.changedAt), desc(schema.destinationChange.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() }));
}
