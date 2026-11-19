import { layoutCapacity } from "@heyqr/qr-core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createLayoutRecord } from "../../entities/qr/model/design-schema";
import * as schema from "../db/schema";

export type UpdateLayoutInput = { qrCodeId: string; layoutId: string; layout: unknown; editor?: unknown; name?: string };
export type UpdateLayoutResult =
  { ok: true; data: { qrCodeId: string; layoutId: string } } | { ok: false; error: "invalid" | "not_found" | "too_long" };

/**
 * HEY-45 "Edit design": replaces one saved layout's design, for the code's owner only, while the code exists (not
 * deleted), and its name when one is given (design "Layout name"). Nothing else changes: the code's content, model,
 * payment status, short link and destination, the layout's order, and its sibling layouts. `encoded` is what the printed code holds (the payload of a static
 * code, the short link of a dynamic one) and must still fit the new layout.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same write path as the action.
 */
export async function updateLayoutDesign(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  input: UpdateLayoutInput,
  encodedFor: (qr: typeof schema.qrCode.$inferSelect) => string,
): Promise<UpdateLayoutResult> {
  const design = createLayoutRecord(input.layout, input.editor);
  if (!design) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (!layoutCapacity(design.layout, encodedFor(qr)).ok) return { ok: false, error: "too_long" } as const;
    const updated = await tx
      .update(schema.qrLayout)
      .set({ design, ...(input.name?.trim() ? { name: input.name.trim().slice(0, 60) } : {}), updatedAt: sql`now()` })
      .where(and(eq(schema.qrLayout.id, input.layoutId), eq(schema.qrLayout.qrCodeId, qr.id)))
      .returning({ id: schema.qrLayout.id });
    if (updated.length === 0) return { ok: false, error: "not_found" } as const;
    await tx
      .update(schema.qrCode)
      .set({ updatedAt: sql`now()` })
      .where(eq(schema.qrCode.id, qr.id));
    return { ok: true, data: { qrCodeId: qr.id, layoutId: input.layoutId } } as const;
  });
}

export type AddLayoutInput = { qrCodeId: string; layout: unknown; editor?: unknown; name: string };
export type AddLayoutResult = { ok: true; data: { layoutId: string } } | { ok: false; error: "invalid" | "not_found" | "too_long" };

/**
 * Design "New layout from this one": adds a named layout to the owner's existing code, after its other layouts, with
 * the given design (the current editor state). The code's content, payment, short link and other layouts are untouched.
 */
export async function addLayoutFrom(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  input: AddLayoutInput,
  encodedFor: (qr: typeof schema.qrCode.$inferSelect) => string,
  newId: () => string,
): Promise<AddLayoutResult> {
  const design = createLayoutRecord(input.layout, input.editor);
  const name = input.name.trim().slice(0, 60);
  if (!design || !name) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (!layoutCapacity(design.layout, encodedFor(qr)).ok) return { ok: false, error: "too_long" } as const;
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.qrLayout.sortOrder}), -1)` })
      .from(schema.qrLayout)
      .where(eq(schema.qrLayout.qrCodeId, qr.id));
    const id = newId();
    await tx.insert(schema.qrLayout).values({ id, qrCodeId: qr.id, name, design, sortOrder: Number(last?.max ?? -1) + 1 });
    await tx
      .update(schema.qrCode)
      .set({ updatedAt: sql`now()` })
      .where(eq(schema.qrCode.id, qr.id));
    return { ok: true, data: { layoutId: id } } as const;
  });
}
