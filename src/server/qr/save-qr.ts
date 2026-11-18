import type { QrContent } from "@heyqr/qr-core";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createLayoutRecord } from "../../entities/qr/model/design-schema";
import { supportsMode } from "../../entities/qr/model/modes";
import { newId } from "../db/ids";
import * as schema from "../db/schema";

export type SaveQrInput = {
  qrCodeId?: string;
  name: string;
  model: "static" | "dynamic";
  content: QrContent;
  destination?: string;
  layouts: { id?: string; name: string; layout: unknown; editor?: unknown }[];
};

export type SaveQrResult = { ok: true; data: { qrCodeId: string; layoutIds: string[] } } | { ok: false; error: "invalid" | "not_found" };

/**
 * Writes a QR code and replaces its design variants in one transaction, for its owner only.
 * Every variant is stored as the versioned design record (schemaVersion 1: rendered layout + editor settings).
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same write path as the saveDraft action.
 */
export async function saveQrWithLayouts(db: NodePgDatabase<typeof schema>, userId: string, input: SaveQrInput): Promise<SaveQrResult> {
  // Only website codes can be dynamic: the short link redirects to a web address (entities/qr/model/modes.ts).
  if (!supportsMode(input.content.type, input.model)) return { ok: false, error: "invalid" };
  const designs = input.layouts.map((l) => createLayoutRecord(l.layout, l.editor));
  if (designs.some((d) => d === null)) return { ok: false, error: "invalid" };

  return db.transaction(async (tx) => {
    const qrCodeId = input.qrCodeId ?? newId();
    if (input.qrCodeId) {
      const updated = await tx
        .update(schema.qrCode)
        .set({ name: input.name, content: input.content, destination: input.destination ?? null })
        .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId)))
        .returning({ id: schema.qrCode.id });
      if (updated.length === 0) return { ok: false, error: "not_found" } as const;
    } else {
      await tx.insert(schema.qrCode).values({
        id: qrCodeId,
        userId,
        name: input.name,
        model: input.model,
        content: input.content,
        destination: input.destination ?? null,
      });
    }

    await tx.delete(schema.qrLayout).where(eq(schema.qrLayout.qrCodeId, qrCodeId));
    const rows = input.layouts.map((l, i) => ({
      id: l.id ?? newId(),
      qrCodeId,
      name: l.name,
      design: designs[i] as NonNullable<(typeof designs)[number]>,
      sortOrder: i,
    }));
    await tx.insert(schema.qrLayout).values(rows);
    return { ok: true, data: { qrCodeId, layoutIds: rows.map((r) => r.id) } } as const;
  });
}
