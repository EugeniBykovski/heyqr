import { layoutCapacity } from "@heyqr/qr-core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createLayoutRecord, type LayoutRecordDesign } from "../../entities/qr/model/design-schema";
import * as schema from "../db/schema";

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
/**
 * HEY-83: runs inside the write's transaction before a layout record is stored (the actions move uploaded logos into
 * private storage here). Null refuses the record as invalid.
 */
export type PrepareRecord = (tx: Tx, record: LayoutRecordDesign) => Promise<LayoutRecordDesign | null>;

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
  prepare?: PrepareRecord,
): Promise<UpdateLayoutResult> {
  const checked = createLayoutRecord(input.layout, input.editor);
  if (!checked) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (!layoutCapacity(checked.layout, encodedFor(qr)).ok) return { ok: false, error: "too_long" } as const;
    const design = prepare ? await prepare(tx, checked) : checked;
    if (!design) return { ok: false, error: "invalid" } as const;
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
  prepare?: PrepareRecord,
): Promise<AddLayoutResult> {
  const checked = createLayoutRecord(input.layout, input.editor);
  const name = input.name.trim().slice(0, 60);
  if (!checked || !name) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select()
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (!layoutCapacity(checked.layout, encodedFor(qr)).ok) return { ok: false, error: "too_long" } as const;
    const design = prepare ? await prepare(tx, checked) : checked;
    if (!design) return { ok: false, error: "invalid" } as const;
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

/**
 * HEY-82 QR details "New layout": a new named layout of the owner's code, copied from one of its saved layouts (design,
 * size, caption, logo and settings) under a new id. The source and the code (content, payment, short link, draft
 * status) are unchanged, so no draft slot is used. A source that isn't a layout of this code is "not_found".
 */
export async function copyLayout(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  input: { qrCodeId: string; sourceLayoutId: string; name: string },
  newId: () => string,
): Promise<AddLayoutResult> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ id: schema.qrCode.id })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    const [source] = await tx
      .select({ design: schema.qrLayout.design })
      .from(schema.qrLayout)
      .where(and(eq(schema.qrLayout.id, input.sourceLayoutId), eq(schema.qrLayout.qrCodeId, qr.id)));
    if (!source) return { ok: false, error: "not_found" } as const;
    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.qrLayout.sortOrder}), -1)` })
      .from(schema.qrLayout)
      .where(eq(schema.qrLayout.qrCodeId, qr.id));
    const id = newId();
    // A deep copy of the stored record: the two layouts share nothing from here on.
    const design = structuredClone(source.design);
    await tx.insert(schema.qrLayout).values({ id, qrCodeId: qr.id, name, design, sortOrder: Number(last?.max ?? -1) + 1 });
    await tx
      .update(schema.qrCode)
      .set({ updatedAt: sql`now()` })
      .where(eq(schema.qrCode.id, qr.id));
    return { ok: true, data: { layoutId: id } } as const;
  });
}

export type DeleteLayoutResult = { ok: true; data: { remaining: number } } | { ok: false; error: "not_found" | "last_layout" };

/**
 * QR details "Delete layout": removes one named layout of the owner's code. The code, its content, payment, Print
 * Pack, short link and destination, and every other layout stay as they are. A code keeps at least one layout: the
 * code's row is locked first, so two deletes at once can't remove its last two layouts.
 */
export async function removeLayout(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  input: { qrCodeId: string; layoutId: string },
): Promise<DeleteLayoutResult> {
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ id: schema.qrCode.id })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    const layouts = await tx.select({ id: schema.qrLayout.id }).from(schema.qrLayout).where(eq(schema.qrLayout.qrCodeId, qr.id));
    if (!layouts.some((l) => l.id === input.layoutId)) return { ok: false, error: "not_found" } as const;
    if (layouts.length <= 1) return { ok: false, error: "last_layout" } as const;
    await tx.delete(schema.qrLayout).where(and(eq(schema.qrLayout.id, input.layoutId), eq(schema.qrLayout.qrCodeId, qr.id)));
    await tx
      .update(schema.qrCode)
      .set({ updatedAt: sql`now()` })
      .where(eq(schema.qrCode.id, qr.id));
    return { ok: true, data: { remaining: layouts.length - 1 } } as const;
  });
}
