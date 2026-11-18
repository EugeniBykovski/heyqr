import "server-only";
import { composeLayout, encodePayload, type Layout, type QrContent } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { env } from "@/env";

export type ExportFormat = "png" | "svg";

/** What the printed code contains: the payload for static codes, the permanent short link for dynamic ones. */
export function encodedValue(qr: { model: "static" | "dynamic"; content: QrContent; shortCode: string | null }) {
  if (qr.model === "dynamic" && qr.shortCode) return `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${qr.shortCode}`;
  return encodePayload(qr.content);
}

const MAX_PNG_WIDTH = 8192;

/** Physical layouts render at a DPI (default 300); screen layouts at a scale factor (default 2×). */
export function pngWidth(layout: Layout, width: number, opts: { dpi?: number; scale?: number }) {
  const px = layout.unit === "mm" ? (width / 25.4) * (opts.dpi ?? 300) : width * (opts.scale ?? 2);
  return Math.min(MAX_PNG_WIDTH, Math.max(64, Math.round(px)));
}

/**
 * Exported files must be self-contained (and resvg can't fetch URLs), so uploaded logos are
 * embedded as data URIs. Only our own bucket is fetched, never an arbitrary URL.
 */
async function embed(href: string | undefined): Promise<string | undefined> {
  if (!href || href.startsWith("data:")) return href;
  if (!env.S3_PUBLIC_URL || !href.startsWith(env.S3_PUBLIC_URL)) return undefined;
  const res = await fetch(href);
  if (!res.ok) return undefined;
  const type = res.headers.get("content-type") ?? "image/png";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

export async function withEmbeddedImages(layout: Layout): Promise<Layout> {
  const logo = layout.style.logo;
  const [logoHref, topLogoHref] = await Promise.all([embed(logo?.href), embed(layout.topLogoHref)]);
  return { ...layout, topLogoHref, style: { ...layout.style, logo: logo ? { ...logo, href: logoHref } : logo } };
}

export async function renderExport(
  layout: Layout,
  value: string,
  format: ExportFormat,
  opts: { dpi?: number; scale?: number; transparent?: boolean },
) {
  const composed = composeLayout(await withEmbeddedImages(layout), value, { transparent: opts.transparent });
  if (format === "svg") return { body: Buffer.from(composed.svg), contentType: "image/svg+xml", scan: composed.scan };
  const width = pngWidth(layout, composed.width, opts);
  return { body: rasterizeSvg(composed.svg, { width }), contentType: "image/png", scan: composed.scan };
}
