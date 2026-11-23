import { parseWebsiteUrl, type WebsiteUrlProblem } from "@heyqr/qr-core";
import { and, eq, isNull } from "drizzle-orm";
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

/**
 * Design 4.4–4.6 Change destination, for the owner's Dynamic code only. Only the destination and the previous one change;
 * the short link (HEY-117) and everything else stay. A refused address changes nothing. Returns the URL stored.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same path as the action.
 */
export async function changeDestination(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  qrCodeId: string,
  raw: unknown,
): Promise<{ ok: true; data: { destination: string } } | DestinationRefusal | { ok: false; error: "not_found" }> {
  const parsed = parseDestination(raw);
  if (!parsed.ok) return parsed;
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ model: schema.qrCode.model, destination: schema.qrCode.destination })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr || qr.model !== "dynamic") return { ok: false, error: "not_found" } as const;
    if (qr.destination !== parsed.url)
      await tx
        .update(schema.qrCode)
        .set({ destination: parsed.url, previousDestination: qr.destination })
        .where(eq(schema.qrCode.id, qrCodeId));
    return { ok: true, data: { destination: parsed.url } } as const;
  });
}
