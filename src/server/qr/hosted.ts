import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  couponExpired,
  hostedAssetIds,
  hostedErrors,
  hostedImages,
  isHostedContent,
  readHostedContent,
  type HostedContent,
  type HostedErrors,
} from "../../entities/qr/model/hosted";
import * as schema from "../db/schema";
import { contentAssetsOwned, storeHostedContent } from "./hosted-assets";
import type { LogoStore } from "./logo-assets";

/*
 * Hosted pages: draft and published (design 10.x / 11.x, handoff "Types 4.0").
 *
 * - The code's `content` is the owner's working draft. Saving it never changes what visitors see.
 * - Publishing (owner only) validates the draft strictly (shape, the shared publishing rules, every file the owner's
 *   and already stored) and adds an immutable `qr_hosted_version`. A refused publish changes nothing, so the previous
 *   version stays live. The QR, its short link and its scan history are never touched.
 * - Visitors see only the latest published version, and only while the short link itself is live (resolveShortLink:
 *   active, not deleted, the plan or trial covers it).
 *
 * Plain module (no "server-only"): the PostgreSQL tests run the same code as the app.
 */
type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type HostedVersion = { version: number; content: HostedContent; publishedAt: Date };

/** The latest published version of a code, or null when it was never published. */
export async function latestHostedVersion(db: Db | Tx, qrCodeId: string): Promise<HostedVersion | null> {
  const [row] = await db
    .select({
      version: schema.qrHostedVersion.version,
      content: schema.qrHostedVersion.content,
      publishedAt: schema.qrHostedVersion.publishedAt,
    })
    .from(schema.qrHostedVersion)
    .where(eq(schema.qrHostedVersion.qrCodeId, qrCodeId))
    .orderBy(desc(schema.qrHostedVersion.version))
    .limit(1);
  if (!row) return null;
  const content = readHostedContent(row.content);
  return content ? { version: row.version, content, publishedAt: row.publishedAt } : null;
}

/** Stable JSON of hosted content without editor-only list ids, to tell whether the draft differs from what's live. */
export function hostedFingerprint(content: HostedContent): string {
  return JSON.stringify(content, (k, v: unknown) => (k === "id" ? undefined : v));
}

export type SaveHostedDraftResult = { ok: true; content: HostedContent } | { ok: false; error: "not_found" | "invalid" | "not_hosted" };

/**
 * Saves the working draft of an existing hosted code (QR details → Edit page). The type stays the same; new photos
 * are stored, files must be the owner's. Nothing public changes.
 */
export async function saveHostedDraft(
  db: Db,
  store: LogoStore | null,
  userId: string,
  qrCodeId: string,
  raw: unknown,
  newId: () => string,
): Promise<SaveHostedDraftResult> {
  const content = readHostedContent(raw);
  if (!content) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ id: schema.qrCode.id, content: schema.qrCode.content, model: schema.qrCode.model })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (!isHostedContent(qr.content) || qr.model !== "dynamic") return { ok: false, error: "not_hosted" } as const;
    if (qr.content.type !== content.type) return { ok: false, error: "invalid" } as const;
    const stored = store ? await storeHostedContent(tx, store, userId, content, newId) : content;
    if (!stored) return { ok: false, error: "invalid" } as const;
    await tx.update(schema.qrCode).set({ content: stored }).where(eq(schema.qrCode.id, qrCodeId));
    return { ok: true, content: stored } as const;
  });
}

export type PublishResult =
  | { ok: true; version: number; publishedAt: Date; unchanged: boolean }
  | { ok: false; error: "not_found" | "not_hosted" | "files" }
  | { ok: false; error: "invalid"; errors: HostedErrors };

/**
 * Publish: the code's current draft becomes its live page. Owner only; the row is locked so two publishes get two
 * consecutive versions. Publishing the same content again is a no-op (no new version).
 */
export async function publishHosted(db: Db, userId: string, qrCodeId: string, now: Date = new Date()): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [qr] = await tx
      .select({ id: schema.qrCode.id, content: schema.qrCode.content, model: schema.qrCode.model })
      .from(schema.qrCode)
      .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)))
      .for("update");
    if (!qr) return { ok: false, error: "not_found" } as const;
    if (qr.model !== "dynamic" || !isHostedContent(qr.content)) return { ok: false, error: "not_hosted" } as const;
    const content = readHostedContent(qr.content);
    if (!content) return { ok: false, error: "invalid", errors: { content: "shape" } } as const;
    const errors = hostedErrors(content, now);
    if (Object.keys(errors).length) return { ok: false, error: "invalid", errors } as const;
    // Every file must already be stored (no inline data) and be the owner's, of the right kind.
    if (hostedImages(content).some((i) => !i.startsWith("asset:")) || !(await contentAssetsOwned(tx, userId, content)))
      return { ok: false, error: "files" } as const;
    const latest = await latestHostedVersion(tx, qrCodeId);
    if (latest && hostedFingerprint(latest.content) === hostedFingerprint(content))
      return { ok: true, version: latest.version, publishedAt: latest.publishedAt, unchanged: true } as const;
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx
      .insert(schema.qrHostedVersion)
      .values({ id: `${qrCodeId}.${version}`, qrCodeId, version, content, publishedAt: now })
      .returning({ publishedAt: schema.qrHostedVersion.publishedAt });
    // Touch the files so cleanup's grace period starts from the publish.
    const ids = hostedAssetIds(content);
    if (ids.length)
      await tx.execute(
        sql`update asset set last_used_at = now() where user_id = ${userId} and id in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`,
      );
    return { ok: true, version, publishedAt: row?.publishedAt ?? now, unchanged: false } as const;
  });
}

/** What the owner's screens show about publishing: the live version and whether the draft has unpublished changes. */
export async function hostedStatus(db: Db, qr: { id: string; content: unknown }) {
  const latest = await latestHostedVersion(db, qr.id);
  const draft = readHostedContent(qr.content);
  return {
    published: latest ? { version: latest.version, publishedAt: latest.publishedAt } : null,
    changed: Boolean(draft && (!latest || hostedFingerprint(latest.content) !== hostedFingerprint(draft))),
  };
}

/**
 * The public copy of a published version: what a visitor's page (and its JSON) may contain. An expired coupon loses
 * its promo code and redemption link (design 11.2: "hides the code"), so they never reach an anonymous visitor.
 * Stored files become URLs under the code's public asset route.
 */
export function publicHostedContent(content: HostedContent, shortCode: string, now: Date = new Date()): HostedContent {
  const url = (ref: string) => (ref.startsWith("asset:") ? `/p/${shortCode}/a/${ref.slice(6)}` : "");
  switch (content.type) {
    case "coupon":
      return couponExpired(content, now) ? { ...content, code: "", link: "" } : content;
    case "menu":
      return {
        ...content,
        sections: content.sections.map((s) => ({ ...s, dishes: s.dishes.map((d) => ({ ...d, photo: d.photo ? url(d.photo) : null })) })),
      };
    case "social":
      return { ...content, photo: content.photo ? url(content.photo) : null };
    case "apps":
      return { ...content, icon: content.icon ? url(content.icon) : null };
    case "product":
      return { ...content, images: content.images.map(url) };
    case "pdf":
      // The file's own name travels with the link, so Download saves it under that name.
      return content.file
        ? { ...content, file: { ...content.file, asset: `${url(content.file.asset)}?name=${encodeURIComponent(content.file.name)}` } }
        : content;
    default:
      return content;
  }
}
