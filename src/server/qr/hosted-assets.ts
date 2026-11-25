import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { HOSTED_LIMITS, hostedAssetIds, type HostedContent } from "../../entities/qr/model/hosted";
import * as schema from "../db/schema";
import { assetRef, attachFile, type LogoStore } from "./logo-assets";

/*
 * Hosted pages: their photos and PDFs live in the account's private object storage (the same `asset` rows and store
 * as logos, under hosted/<user>/<asset>). The server is the authority on every file: the type is read from the bytes
 * (never the name or the browser's MIME guess) and the limits are the design's (photos JPG or PNG up to 5 MB, a PDF up
 * to 25 MB and 300 pages). Plain module: the store is passed in, so the PostgreSQL tests run the same code.
 */
type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const REF = /^asset:([A-Za-z0-9_-]{6,64})$/;
export const HOSTED_IMAGE_MIME = { png: "image/png", jpeg: "image/jpeg" } as const;
export const PDF_MIME = "application/pdf";

export type HostedImageCheck = { ok: true; format: "png" | "jpeg"; bytes: Uint8Array } | { ok: false; reason: "type" | "tooLarge" };

/** A photo of a hosted page, as the editor sends it (a base64 data URL): JPG or PNG by its bytes, up to 5 MB. */
export function checkHostedImage(dataUrl: string): HostedImageCheck {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return { ok: false, reason: "type" };
  const bytes = Buffer.from(m[2] ?? "", "base64");
  if (bytes.byteLength > HOSTED_LIMITS.imageBytes) return { ok: false, reason: "tooLarge" };
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const format = png ? "png" : jpeg ? "jpeg" : null;
  if (!format || HOSTED_IMAGE_MIME[format] !== m[1]) return { ok: false, reason: "type" };
  return { ok: true, format, bytes };
}

export type PdfCheck =
  { ok: true; pages: number } | { ok: false; reason: "notPdf" | "empty" | "tooLarge" | "tooManyPages" | "unreadable"; pages?: number };

/**
 * A PDF upload: not empty, at most 25 MB, a real PDF (`%PDF-` header and an `%%EOF` trailer) and at most 300 pages.
 * The page count is the page tree's `/Count` (the largest, i.e. the root's), read from the file and from its
 * compressed object streams. A file whose pages can't be counted is refused rather than accepted unchecked.
 */
export function checkPdf(bytes: Uint8Array): PdfCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > HOSTED_LIMITS.pdfBytes) return { ok: false, reason: "tooLarge" };
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = buf.subarray(0, 1024).toString("latin1");
  if (!head.includes("%PDF-")) return { ok: false, reason: "notPdf" };
  if (
    !buf
      .subarray(Math.max(0, buf.byteLength - 2048))
      .toString("latin1")
      .includes("%%EOF")
  )
    return { ok: false, reason: "unreadable" };
  const pages = pdfPageCount(buf);
  if (pages === null || pages < 1) return { ok: false, reason: "unreadable" };
  if (pages > HOSTED_LIMITS.pdfPages) return { ok: false, reason: "tooManyPages", pages };
  return { ok: true, pages };
}

function pdfPageCount(buf: Buffer): number | null {
  const text = buf.toString("latin1");
  let best = maxPagesCount(text);
  if (best !== null) return best;
  // PDF 1.5+: the page tree can sit inside compressed object streams.
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = re.exec(text)) && scanned < 2000) {
    scanned++;
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    const dict = text.slice(Math.max(0, m.index - 400), m.index);
    if (/\/Subtype\s*\/Image/.test(dict) || !/\/FlateDecode/.test(dict)) continue;
    try {
      const found = maxPagesCount(inflateSync(buf.subarray(start, end)).toString("latin1"));
      if (found !== null) best = Math.max(best ?? 0, found);
    } catch {
      // Not a deflate stream (or truncated): skip it.
    }
    re.lastIndex = end;
  }
  return best;
}

function maxPagesCount(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/\/Type\s*\/Pages\b([^]*?)>>/g)) {
    const count = /\/Count\s+(\d+)/.exec(m[1] ?? "");
    if (count?.[1]) best = Math.max(best ?? 0, Number(count[1]));
  }
  // Some writers put /Count before /Type in the same dictionary.
  for (const m of text.matchAll(/<<([^<>]*?\/Count\s+(\d+)[^<>]*?)>>/g)) {
    if (/\/Type\s*\/Pages\b/.test(m[1] ?? "") && m[2]) best = Math.max(best ?? 0, Number(m[2]));
  }
  return best;
}

/** Stores a checked PDF for its owner and returns its asset id (the same file twice is one asset). */
export async function storePdf(db: Db, store: LogoStore, userId: string, bytes: Uint8Array, newId: () => string): Promise<string> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return db.transaction((tx) => attachFile(tx, store, userId, { bytes, sha256, ext: "pdf", mime: PDF_MIME, prefix: "hosted" }, newId));
}

/**
 * Saving a hosted draft: every new photo (a data URL) is checked and stored, and every `asset:<id>` must be one of the
 * owner's files of the right kind (an image for photos, a PDF for the document); they are touched so cleanup keeps
 * them. Returns the content with references only, or null when a file breaks the rules.
 */
export async function storeHostedContent(
  tx: Tx,
  store: LogoStore,
  userId: string,
  content: HostedContent,
  newId: () => string,
): Promise<HostedContent | null> {
  const known = new Map<string, Promise<string | null>>();
  let invalid = false;
  const ownRef = async (id: string, kind: "image" | "pdf") => {
    const [row] = await tx
      .update(schema.asset)
      .set({ lastUsedAt: sql`now()` })
      .where(and(eq(schema.asset.id, id), eq(schema.asset.userId, userId)))
      .returning({ type: schema.asset.contentType });
    return (
      Boolean(row) &&
      (kind === "pdf" ? row?.type === PDF_MIME : row?.type === HOSTED_IMAGE_MIME.png || row?.type === HOSTED_IMAGE_MIME.jpeg)
    );
  };
  const image = async (value: string): Promise<string> => {
    const ref = REF.exec(value);
    if (ref?.[1]) {
      if (!(await ownRef(ref[1], "image"))) invalid = true;
      return value;
    }
    let pending = known.get(value);
    if (!pending) {
      const check = checkHostedImage(value);
      pending = check.ok
        ? attachFile(
            tx,
            store,
            userId,
            {
              bytes: check.bytes,
              sha256: createHash("sha256").update(check.bytes).digest("hex"),
              ext: check.format === "png" ? "png" : "jpg",
              mime: HOSTED_IMAGE_MIME[check.format],
              prefix: "hosted",
            },
            newId,
          ).then(assetRef)
        : Promise.resolve(null);
      known.set(value, pending);
    }
    const out = await pending;
    if (!out) invalid = true;
    return out ?? value;
  };
  const maybe = async (v: string | null) => (v ? image(v) : null);

  let next: HostedContent;
  switch (content.type) {
    case "menu":
      next = {
        ...content,
        sections: await Promise.all(
          content.sections.map(async (s) => ({
            ...s,
            dishes: await Promise.all(s.dishes.map(async (d) => ({ ...d, photo: await maybe(d.photo) }))),
          })),
        ),
      };
      break;
    case "social":
      next = { ...content, photo: await maybe(content.photo) };
      break;
    case "apps":
      next = { ...content, icon: await maybe(content.icon) };
      break;
    case "product":
      next = { ...content, images: await Promise.all(content.images.map(image)) };
      break;
    case "pdf": {
      const id = content.file ? REF.exec(content.file.asset)?.[1] : undefined;
      if (content.file && (!id || !(await ownRef(id, "pdf")))) invalid = true;
      next = content;
      break;
    }
    default:
      next = content;
  }
  return invalid ? null : next;
}

/** The stored files of the owner among `ids`, with their type (for resolving drafts and checking a publish). */
export async function ownedAssets(db: Db | Tx, userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({ id: schema.asset.id, key: schema.asset.storageKey, type: schema.asset.contentType, bytes: schema.asset.byteSize })
    .from(schema.asset)
    .where(and(inArray(schema.asset.id, ids), eq(schema.asset.userId, userId)));
}

/** True when every file the content refers to is the owner's and of the right kind. */
export async function contentAssetsOwned(db: Db | Tx, userId: string, content: HostedContent): Promise<boolean> {
  const ids = hostedAssetIds(content);
  const rows = await ownedAssets(db, userId, ids);
  if (rows.length !== ids.length) return false;
  const pdfId = content.type === "pdf" && content.file ? REF.exec(content.file.asset)?.[1] : undefined;
  return rows.every((r) => (r.id === pdfId ? r.type === PDF_MIME : r.type === HOSTED_IMAGE_MIME.png || r.type === HOSTED_IMAGE_MIME.jpeg));
}
