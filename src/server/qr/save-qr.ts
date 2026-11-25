import { encodePayload, layoutCapacity } from "@heyqr/qr-core";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createLayoutRecord, type LayoutRecordDesign } from "../../entities/qr/model/design-schema";
import type { PrepareRecord } from "./update-layout";
import { supportsMode } from "../../entities/qr/model/modes";
import { isHostedContent, readHostedContent, type AnyQrContent, type HostedContent } from "../../entities/qr/model/hosted";
import { DRAFT_LIMIT } from "../../shared/config/catalog-core";
import { newId } from "../db/ids";
import * as schema from "../db/schema";
import { parseDestination, type DestinationRefusal } from "./destination";

export type SaveQrInput = {
  qrCodeId?: string;
  name: string;
  model: "static" | "dynamic";
  content: AnyQrContent;
  destination?: string;
  layouts: { id?: string; name: string; layout: unknown; editor?: unknown }[];
  /**
   * HEY-77: the browser draft's random key. A new code saved with it records it; saving again with the same key for
   * the same account (a refresh, a retry after a lost response, a second tab) returns that code unchanged instead of a
   * duplicate. Another account's code is never found or changed this way.
   */
  claimKey?: string;
};

export type SaveQrResult =
  | { ok: true; data: { qrCodeId: string; layoutIds: string[] } }
  | { ok: false; error: "invalid" | "not_found" | "too_long" | "draft_limit" }
  | DestinationRefusal;

/**
 * Writes a QR code and replaces its design variants in one transaction, for its owner only.
 * Every variant is stored as the versioned design record (schemaVersion 1: rendered layout + editor settings).
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same write path as the saveDraft action.
 */
/** The database, or a transaction already open (HEY-165: the save then runs as a nested transaction, a savepoint). */
type DbOrTx = NodePgDatabase<typeof schema> | Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

/** Stores a hosted draft's new photos (and checks its files) inside the save's transaction; null refuses the save. */
export type PrepareContent = (
  tx: Parameters<Parameters<DbOrTx["transaction"]>[0]>[0],
  content: HostedContent,
) => Promise<HostedContent | null>;

export async function saveQrWithLayouts(
  db: DbOrTx,
  userId: string,
  input: SaveQrInput,
  prepare?: PrepareRecord,
  prepareContent?: PrepareContent,
): Promise<SaveQrResult> {
  // Of the direct types only website codes can be dynamic; hosted pages are always dynamic (entities/qr/model/modes.ts).
  if (!supportsMode(input.content.type, input.model)) return { ok: false, error: "invalid" };
  // A hosted draft must match its stored shape (it may still be unfinished: publishing checks the rules).
  const hosted = isHostedContent(input.content) ? readHostedContent(input.content) : null;
  if (isHostedContent(input.content) && !hosted) return { ok: false, error: "invalid" };
  const designs = input.layouts.map((l) => createLayoutRecord(l.layout, l.editor));
  if (designs.some((d) => d === null)) return { ok: false, error: "invalid" };
  // HEY-119: a Dynamic code's destination passes the same check as Change destination (its website address when none
  // is given); a refused one saves nothing. A static code has no destination. HEY-124: it is written for a new code,
  // or an existing Dynamic draft not yet published (no short link); see "Writes" below.
  let destination: string | null = null;
  if (input.model === "dynamic" && !hosted) {
    const parsed = parseDestination(input.destination ?? (input.content.type === "website" ? input.content.url : ""));
    if (!parsed.ok) return parsed;
    destination = parsed.url;
  }
  // HEY-24: a static code must be encodable with every variant's layout (a center logo lowers the limit). Dynamic codes
  // encode only their short link, which always fits.
  if (input.model === "static" && !isHostedContent(input.content)) {
    const payload = encodePayload(input.content);
    if (designs.some((d) => d && !layoutCapacity(d.layout, payload).ok)) return { ok: false, error: "too_long" };
  }

  return db.transaction(async (tx) => {
    const qrCodeId = input.qrCodeId ?? newId();
    // 1. Checks first (HEY-84: a refused save stores nothing): the user's own code, or the claim and the draft limit.
    // HEY-124: the stored code (model and short link), read under its row lock, decides whether the destination is written.
    let existing: { model: "static" | "dynamic"; shortCode: string | null; content: AnyQrContent } | undefined;
    if (input.qrCodeId) {
      const [own] = await tx
        .select({ id: schema.qrCode.id, model: schema.qrCode.model, shortCode: schema.qrCode.shortCode, content: schema.qrCode.content })
        .from(schema.qrCode)
        .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
        .for("update");
      if (!own) return { ok: false, error: "not_found" } as const;
      // A saved code keeps its kind: a hosted page stays the same hosted type, a direct code never becomes one.
      if (isHostedContent(own.content) !== Boolean(hosted) || (hosted && own.content.type !== hosted.type))
        return { ok: false, error: "invalid" } as const;
      existing = own;
    } else {
      // Design Pricing · Free: up to DRAFT_LIMIT saved drafts (codes not yet unlocked or live). Saves of one account
      // are serialized, so two at once can't both pass the count.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`drafts:${userId}`}))`);
      if (input.claimKey) {
        const [claimed] = await tx
          .select({ id: schema.qrCode.id })
          .from(schema.qrCode)
          .where(and(eq(schema.qrCode.userId, userId), eq(schema.qrCode.guestClaimKey, input.claimKey), isNull(schema.qrCode.deletedAt)));
        if (claimed) {
          const layouts = await tx
            .select({ id: schema.qrLayout.id })
            .from(schema.qrLayout)
            .where(eq(schema.qrLayout.qrCodeId, claimed.id))
            .orderBy(asc(schema.qrLayout.sortOrder));
          return { ok: true, data: { qrCodeId: claimed.id, layoutIds: layouts.map((l) => l.id) } } as const;
        }
      }
      const [drafts] = await tx
        .select({ n: count() })
        .from(schema.qrCode)
        .where(and(eq(schema.qrCode.userId, userId), eq(schema.qrCode.status, "draft"), isNull(schema.qrCode.deletedAt)));
      if ((drafts?.n ?? 0) >= DRAFT_LIMIT) return { ok: false, error: "draft_limit" } as const;
    }

    // 2. HEY-83: uploaded logos into the account's private storage, before any row is written.
    const stored: LayoutRecordDesign[] = [];
    for (const d of designs) {
      const p = d && (prepare ? await prepare(tx, d) : d);
      if (!p) return { ok: false, error: "invalid" } as const;
      stored.push(p);
    }

    // Hosted pages: new photos into storage too, and every referenced file must be the owner's.
    let content: AnyQrContent = input.content;
    if (hosted) {
      const stored = prepareContent ? await prepareContent(tx, hosted) : hosted;
      if (!stored) return { ok: false, error: "invalid" } as const;
      content = stored;
    }

    // 3. Writes.
    if (existing) {
      // HEY-124: saving the design of an existing code never publishes a URL. A published Dynamic code (it has a short
      // link) keeps its destination, previous destination and change time: only Change destination (changeDestination)
      // changes them, so a save from a tab opened before a change can't bring the old URL back. A Dynamic draft not
      // yet published may still update its destination (nothing scans it yet); a static code never gets one.
      const draftDestination = existing.model === "dynamic" && !existing.shortCode && input.model === "dynamic" ? { destination } : {};
      await tx
        .update(schema.qrCode)
        .set({ name: input.name, content, ...draftDestination })
        .where(eq(schema.qrCode.id, qrCodeId));
    } else {
      await tx.insert(schema.qrCode).values({
        id: qrCodeId,
        userId,
        name: input.name,
        model: input.model,
        content,
        destination,
        guestClaimKey: input.claimKey ?? null,
      });
    }

    await tx.delete(schema.qrLayout).where(eq(schema.qrLayout.qrCodeId, qrCodeId));
    const rows = input.layouts.map((l, i) => ({
      id: l.id ?? newId(),
      qrCodeId,
      name: l.name,
      design: stored[i] as LayoutRecordDesign,
      sortOrder: i,
    }));
    await tx.insert(schema.qrLayout).values(rows);
    return { ok: true, data: { qrCodeId, layoutIds: rows.map((r) => r.id) } } as const;
  });
}
