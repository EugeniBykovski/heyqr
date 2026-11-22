import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { referencedAssets } from "./logo-assets";

type Db = NodePgDatabase<typeof schema>;

/**
 * HEY-84: the one authorization chain for a code's files. The user comes from the session; the code must be theirs and
 * not deleted, the layout must belong to that code. Null for anything else (another account, a layout of another code,
 * a deleted code), so callers answer "not found" and never reveal whether the record exists.
 * Plain module (no "server-only") so the PostgreSQL tests exercise the same checks as the actions and routes.
 */
export async function ownedLayout(db: Db, userId: string, qrCodeId: string, layoutId: string) {
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)),
  });
  if (!qr) return null;
  const layout = await db.query.qrLayout.findFirst({
    where: and(eq(schema.qrLayout.id, layoutId), eq(schema.qrLayout.qrCodeId, qr.id)),
  });
  return layout ? { qr, layout } : null;
}

/**
 * The storage key of a logo file, only when the whole chain holds: the user's code, a layout of that code, a logo that
 * layout's saved design refers to, and a file the same user owns. The key comes from these records, never from input.
 */
export async function authorizedLogo(db: Db, userId: string, input: { qrCodeId: string; layoutId: string; assetId: string }) {
  const owned = await ownedLayout(db, userId, input.qrCodeId, input.layoutId);
  if (!owned || !referencedAssets(owned.layout.design).includes(input.assetId)) return null;
  const asset = await db.query.asset.findFirst({ where: and(eq(schema.asset.id, input.assetId), eq(schema.asset.userId, userId)) });
  return asset ? { key: asset.storageKey, contentType: asset.contentType, layoutName: owned.layout.name } : null;
}
