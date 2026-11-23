/**
 * HEY-118: what a Dynamic code encodes. Once activated, that is its issued short link. Before that, every preview
 * (Create, guest and saved Export, My QR codes, QR details) shows the same placeholder link of the same length, so
 * the pattern, capacity and size match the file later downloaded. "preview" contains an "i", which the slug
 * alphabet (server/db/ids.ts) excludes, so it can never be an issued slug.
 */
export const PREVIEW_SLUG = "preview";

export const shortLinkUrl = (base: string, slug: string) => `${base.replace(/\/$/, "")}/${slug}`;

export const previewShortLink = (base: string) => shortLinkUrl(base, PREVIEW_SLUG);
