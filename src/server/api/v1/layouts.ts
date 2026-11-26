import { unsupportedCaptionChars } from "@heyqr/qr-core";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { readLayoutRecord, type LayoutRecordDesign } from "../../../entities/qr/model/design-schema";
import * as schema from "../../db/schema";
import { resolveLogos, type LogoStore } from "../../qr/logo-assets";
import { layoutRevision, updateLayoutDesign, type PrepareRecord } from "../../qr/update-layout";
import { isLayoutShaped, type Problem } from "./create-qr";

/*
 * HEY-156 / QR-21.04: read and update one saved layout through the public API:
 *   GET   /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}
 *   PATCH /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}
 * Scoped to the verified key's owner: the code must be theirs and not deleted, and the layout must belong to that code;
 * anything else is the same "not found". Updates are the editor's own Edit design save (updateLayoutDesign): the
 * versioned design contract, the capacity check, logo storage, and the HEY-85 revision check under the code's row lock.
 * Only that layout changes. Plain module (no "server-only") so the PostgreSQL tests run it.
 */
type Db = NodePgDatabase<typeof schema>;

/** The layout as the API shows it: explicit public fields; stored logos resolved, never `asset:` references. */
export type ApiLayout = {
  id: string;
  qrCodeId: string;
  name: string;
  revision: string;
  layout: LayoutRecordDesign["layout"];
  editor: NonNullable<LayoutRecordDesign["editor"]> | null;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Without configured storage no stored logo can be read: its reference is dropped, never returned. */
const NO_STORE: LogoStore = { get: async () => null, put: async () => undefined, remove: async () => undefined };

/** The owner's layout of the owner's (not deleted) code, with its stored design and revision; null otherwise. */
async function ownedRow(db: Db, userId: string, qrCodeId: string, layoutId: string) {
  if (!ID.test(qrCodeId) || !ID.test(layoutId)) return null;
  const [row] = await db
    .select({
      id: schema.qrLayout.id,
      qrCodeId: schema.qrLayout.qrCodeId,
      name: schema.qrLayout.name,
      design: schema.qrLayout.design,
      revision: layoutRevision,
    })
    .from(schema.qrLayout)
    .innerJoin(schema.qrCode, eq(schema.qrCode.id, schema.qrLayout.qrCodeId))
    .where(
      and(
        eq(schema.qrLayout.id, layoutId),
        eq(schema.qrLayout.qrCodeId, qrCodeId),
        eq(schema.qrCode.userId, userId),
        isNull(schema.qrCode.deletedAt),
      ),
    );
  return row ?? null;
}

/** GET: the layout, or null (not the owner's, deleted, a layout of another code, or an unreadable record). */
export async function readLayoutForOwner(
  db: Db,
  userId: string,
  qrCodeId: string,
  layoutId: string,
  store: LogoStore | null,
): Promise<ApiLayout | null> {
  const row = await ownedRow(db, userId, qrCodeId, layoutId);
  if (!row) return null;
  const read = readLayoutRecord(row.design);
  if (!read.ok) return null;
  const [design] = await resolveLogos(db, store ?? NO_STORE, userId, [read.value]);
  if (!design) return null;
  return {
    id: row.id,
    qrCodeId: row.qrCodeId,
    name: row.name,
    revision: row.revision,
    layout: design.layout,
    editor: design.editor ?? null,
  };
}

/**
 * The PATCH body: only the layout's own fields, plus the revision GET returned (required). Fields left out keep their
 * stored value; send `layout` and `editor` together to keep them in step. Unknown fields (the code's content, mode,
 * destination, ids, state…) are refused.
 */
export const updateLayoutRequestSchema = z
  .strictObject({
    revision: z.string().regex(/^\d{1,20}$/, "The revision from GET is required"),
    name: z.string().trim().min(1).max(60).optional(),
    layout: z.unknown().optional(),
    editor: z.unknown().optional(),
  })
  .refine(
    (b) => b.name !== undefined || b.layout !== undefined || b.editor !== undefined,
    "Nothing to update: send name, layout or editor",
  );

export type UpdateLayoutOutcome =
  | { ok: true; layout: ApiLayout }
  | { ok: false; error: "not_found" | "conflict" | "content_too_long" }
  | { ok: false; error: "invalid_request"; details: Problem[] };

const pathOf = (path: readonly PropertyKey[]) =>
  path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
    .join("")
    .replace(/^\./, "");

/** PATCH: updates the owner's layout from `body`, only while it is still at the given revision. */
export async function updateLayoutForOwner(
  db: Db,
  userId: string,
  qrCodeId: string,
  layoutId: string,
  body: unknown,
  deps: { encodedFor: (qr: typeof schema.qrCode.$inferSelect) => string; prepare?: PrepareRecord; store: LogoStore | null },
): Promise<UpdateLayoutOutcome> {
  const row = await ownedRow(db, userId, qrCodeId, layoutId);
  if (!row) return { ok: false, error: "not_found" };
  const parsed = updateLayoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.flatMap((issue): Problem[] =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => ({ path: pathOf([...issue.path, key]), message: "Unknown field" }))
        : [{ path: pathOf(issue.path) || "(body)", message: issue.message }],
    );
    return { ok: false, error: "invalid_request", details: details.slice(0, 20) };
  }
  const current = readLayoutRecord(row.design);
  if (!current.ok) return { ok: false, error: "not_found" };
  const { revision, name, layout, editor } = parsed.data;
  // Fields left out keep the stored value (its logos stay `asset:` references of this owner, kept by storeLogos).
  const result = await updateLayoutDesign(
    db,
    userId,
    {
      qrCodeId,
      layoutId,
      revision,
      layout: layout ?? current.value.layout,
      editor: editor ?? current.value.editor,
      ...(name === undefined ? {} : { name }),
    },
    deps.encodedFor,
    deps.prepare,
  );
  if (!result.ok) {
    if (result.error === "invalid")
      return {
        ok: false,
        error: "invalid_request",
        details: [
          isLayoutShaped(layout) && unsupportedCaptionChars(layout).length
            ? {
                path: "layout.caption.text",
                message: `The caption font can't draw ${unsupportedCaptionChars(layout).slice(0, 8).join(" ")}; choose another font or change the text`,
              }
            : { path: layout === undefined ? "editor" : "layout", message: "Not a valid design (see docs/API_V1.md)" },
        ],
      };
    if (result.error === "too_long") return { ok: false, error: "content_too_long" };
    return { ok: false, error: result.error };
  }
  const saved = await readLayoutForOwner(db, userId, qrCodeId, layoutId, deps.store);
  return saved ? { ok: true, layout: saved } : { ok: false, error: "not_found" };
}
