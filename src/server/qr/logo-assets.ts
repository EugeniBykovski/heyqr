import { createHash } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { checkLogoDataUrl, LOGO_MIME, type LogoFormat } from "../../entities/qr/model/logo";
import * as schema from "../db/schema";

/*
 * HEY-83: uploaded logos live in private object storage, never inline in saved designs and never behind a public URL.
 *
 * - Save: every uploaded image in a layout record (a `data:image/…` URL, as the editor and the browser draft hold it)
 *   is checked with the HEY-50 rule, stored once per account and file (sha256) under logos/<user>/<asset>, and
 *   replaced by `asset:<id>`. Saving touches the asset (lastUsedAt) under a row lock.
 * - Read: `asset:<id>` references of a code are resolved for that code's owner only, back to data URLs, so the editor,
 *   thumbnails, exports and print files render exactly as before. Older records with inline images still read as-is.
 * - Lifecycle: an asset is attached while any saved layout refers to it (soft-deleted codes included, so they can be
 *   restored). One that no layout refers to and that hasn't been used for CLEANUP_AFTER_MS is removed with its object.
 *   Save and cleanup lock the asset row, so a save can't attach a file that cleanup is deleting (it stores it again).
 *
 * Plain module (no "server-only"): the store is passed in, so the PostgreSQL tests use the same code with a memory store.
 */

/** What saving and rendering need from object storage. */
export type LogoStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
};

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const REF = /^asset:([A-Za-z0-9_-]{6,64})$/;
const DATA_IMAGE = /^data:image\//;
const EXT: Record<LogoFormat, string> = { png: "png", jpeg: "jpg", webp: "webp", svg: "svg" };
/** An unreferenced asset is kept this long after its last use (an abandoned upload, a just-deleted layout). */
export const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export const assetRef = (id: string) => `asset:${id}`;

/** The fields a layout record keeps images in: logo `href`, card `topLogoHref`, artwork `image`. */
const IMAGE_KEYS = new Set(["href", "topLogoHref", "image"]);

/** Every image field in a JSON value, rewritten by `fn` (async); undefined removes the field. Everything else stays. */
async function mapImages(value: unknown, fn: (s: string) => Promise<string | undefined>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => mapImages(v, fn)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([k, v]) => [k, typeof v === "string" && IMAGE_KEYS.has(k) ? await fn(v) : await mapImages(v, fn)] as const,
      ),
    );
    return Object.fromEntries(entries.filter(([, v]) => v !== undefined));
  }
  return value;
}

function images(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) images(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string" && IMAGE_KEYS.has(k)) out.push(v);
      else images(v, out);
    }
  return out;
}

/** The asset ids a stored design refers to. */
export const referencedAssets = (design: unknown) => [...new Set(images(design).flatMap((s) => REF.exec(s)?.[1] ?? []))];

/**
 * Moves the uploaded images of one layout record into storage for `userId` and returns the record with `asset:<id>`
 * references. Null when an image breaks the logo rule, or refers to an asset that isn't this account's.
 */
export async function storeLogos<T>(tx: Tx, store: LogoStore, userId: string, record: T, newId: () => string): Promise<T | null> {
  // One store per image per save: the same file appears in the rendered layout and the editor settings, and fields
  // are mapped concurrently, so the in-flight result is shared (not just the finished one).
  const known = new Map<string, Promise<string | null>>();
  let invalid = false;
  const one = (s: string): Promise<string | null> => {
    const check = checkLogoDataUrl(s);
    if (!check.ok) return Promise.resolve(null);
    const bytes = Buffer.from(s.slice(s.indexOf(",") + 1), "base64");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return attachFile(
      tx,
      store,
      userId,
      { bytes, sha256, ext: EXT[check.format], mime: LOGO_MIME[check.format], prefix: "logos" },
      newId,
    ).then(assetRef);
  };
  const next = await mapImages(record, async (s) => {
    const ref = REF.exec(s);
    if (ref?.[1]) {
      // Only the account's own stored files; touching keeps them out of cleanup while this save commits.
      const [own] = await tx
        .update(schema.asset)
        .set({ lastUsedAt: sql`now()` })
        .where(and(eq(schema.asset.id, ref[1]), eq(schema.asset.userId, userId)))
        .returning({ id: schema.asset.id });
      if (!own) invalid = true;
      return s;
    }
    if (!DATA_IMAGE.test(s)) return s;
    let pending = known.get(s);
    if (!pending) {
      pending = one(s);
      known.set(s, pending);
    }
    const out = await pending;
    if (!out) invalid = true;
    return out ?? s;
  });
  return invalid ? null : (next as T);
}

/**
 * The account's asset for this file: the existing one (touched, row locked) or a new one stored now under
 * `<prefix>/<user>/<asset>.<ext>`. Logos and hosted-page files (photos, PDFs) share it.
 */
export async function attachFile(
  tx: Tx,
  store: LogoStore,
  userId: string,
  file: { bytes: Uint8Array; sha256: string; ext: string; mime: string; prefix: "logos" | "hosted" },
  newId: () => string,
): Promise<string> {
  const [existing] = await tx
    .update(schema.asset)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(schema.asset.userId, userId), eq(schema.asset.sha256, file.sha256)))
    .returning({ id: schema.asset.id });
  if (existing) return existing.id;
  const id = newId();
  const key = `${file.prefix}/${userId}/${id}.${file.ext}`;
  await store.put(key, file.bytes, file.mime);
  const [inserted] = await tx
    .insert(schema.asset)
    .values({ id, userId, storageKey: key, contentType: file.mime, byteSize: file.bytes.byteLength, sha256: file.sha256 })
    .onConflictDoNothing()
    .returning({ id: schema.asset.id });
  if (inserted) return inserted.id;
  // The same file was stored by another save of this account a moment ago: use that one (ours is cleaned up later).
  const [winner] = await tx
    .select({ id: schema.asset.id })
    .from(schema.asset)
    .where(and(eq(schema.asset.userId, userId), eq(schema.asset.sha256, file.sha256)));
  if (!winner) throw new Error("asset vanished");
  await store.remove(key).catch(() => undefined);
  return winner.id;
}

/** Recently resolved files (they never change: a new file is a new asset). */
const cache = new Map<string, string>();
const CACHE_MAX = 64;

/**
 * Resolves `asset:<id>` references in records of codes owned by `ownerId` back to data URLs. A reference to an asset
 * that isn't the owner's, or whose file is missing, is dropped (the layout renders without that image).
 */
export async function resolveLogos<T>(db: Db, store: LogoStore, ownerId: string, records: T[]): Promise<T[]> {
  const ids = [...new Set(records.flatMap((r) => referencedAssets(r)))];
  if (!ids.length) return records;
  const rows = await db
    .select({ id: schema.asset.id, key: schema.asset.storageKey, type: schema.asset.contentType })
    .from(schema.asset)
    .where(and(inArray(schema.asset.id, ids), eq(schema.asset.userId, ownerId)));
  const urls = new Map<string, string>();
  await Promise.all(
    rows.map(async (row) => {
      const hit = cache.get(row.id);
      if (hit) return void urls.set(row.id, hit);
      const bytes = await store.get(row.key).catch(() => null);
      if (!bytes) return;
      const url = `data:${row.type};base64,${Buffer.from(bytes).toString("base64")}`;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(row.id, url);
      urls.set(row.id, url);
    }),
  );
  return Promise.all(
    records.map(async (r) => {
      if (!referencedAssets(r).length) return r;
      const resolved = await mapImages(r, async (s) => {
        const ref = REF.exec(s);
        return ref?.[1] ? urls.get(ref[1]) : s;
      });
      return withoutDanglingLogos(resolved) as T;
    }),
  );
}

/** An editor logo `{ kind: "image" }` whose file couldn't be resolved becomes "no logo", so the design stays valid. */
function withoutDanglingLogos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDanglingLogos);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.kind === "image" && typeof o.href !== "string") return { kind: "none" };
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, withoutDanglingLogos(v)]));
  }
  return value;
}

/**
 * Removes assets that nothing refers to (no saved layout, no hosted page draft, no published hosted version;
 * soft-deleted codes count: they can be restored) and that haven't been used for `olderThanMs`, then their objects. Rows a save holds are skipped; a save after the delete stores the file
 * again. Returns the removed storage keys.
 */
export async function cleanupLogos(db: Db, store: LogoStore, olderThanMs = CLEANUP_AFTER_MS): Promise<string[]> {
  const removed = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: schema.asset.id, key: schema.asset.storageKey })
      .from(schema.asset)
      .where(lt(schema.asset.lastUsedAt, sql`now() - make_interval(secs => ${olderThanMs / 1000})`))
      .for("update", { skipLocked: true });
    const gone: string[] = [];
    for (const c of candidates) {
      const [used] = await tx
        .execute<{ n: number }>(
          sql`select ((select count(*) from qr_layout where design::text like ${`%"asset:${c.id}"%`})
            + (select count(*) from qr_code where content::text like ${`%"asset:${c.id}"%`})
            + (select count(*) from qr_hosted_version where content::text like ${`%"asset:${c.id}"%`}))::int as n`,
        )
        .then((r) => r.rows);
      if ((used?.n ?? 0) > 0) continue;
      await tx.delete(schema.asset).where(eq(schema.asset.id, c.id));
      gone.push(c.key);
    }
    return gone;
  });
  // Objects go after the rows are gone for good, so nothing can refer to them any more.
  for (const key of removed) await store.remove(key).catch(() => undefined);
  return removed;
}
