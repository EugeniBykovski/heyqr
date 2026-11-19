import "server-only";
import {
  composeLayout,
  encodePayload,
  PNG_MAX_SIDE,
  PNG_MIN_SIDE,
  pngPixelSize,
  type Layout,
  type PngResolution,
  type QrContent,
} from "@heyqr/qr-core";
import path from "node:path";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { env } from "@/env";

export type ExportFormat = "png" | "svg";

/**
 * DM Sans, the caption font of the on-screen preview, as static TTF files (400 and 700, optical size 14) for resvg
 * (HEY-43). Without them the PNG caption fell back to a system font. Traced into the build via next.config.ts.
 * Characters DM Sans lacks (Cyrillic, emoji) still fall back to system fonts, as they do in the browser.
 */
export const CAPTION_FONT_FILES = ["DMSans-Regular.ttf", "DMSans-Bold.ttf"].map((f) =>
  path.join(process.cwd(), "packages/qr-core/fonts", f),
);

/** What the printed code contains: the payload for static codes, the permanent short link for dynamic ones. */
export function encodedValue(qr: { model: "static" | "dynamic"; content: QrContent; shortCode: string | null }) {
  if (qr.model === "dynamic" && qr.shortCode) return `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${qr.shortCode}`;
  return encodePayload(qr.content);
}

/** PNG width for a layout: physical layouts at a DPI (default 300), screen layouts at a scale (default 2×). */
export function pngWidth(layout: Layout, _width: number, opts: PngResolution) {
  return pngPixelSize(layout, opts).width;
}

/** The requested PNG would be outside the export limits (64–8192 px a side); nothing is rasterized. */
export class ExportSizeError extends Error {
  constructor(public readonly size: { width: number; height: number }) {
    super(`PNG of ${size.width} × ${size.height} px is outside the export limits (${PNG_MIN_SIDE}–${PNG_MAX_SIDE} px).`);
    this.name = "ExportSizeError";
  }
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
  // HEY-37: the whole layout at the requested resolution, aspect ratio kept; validated before rasterizing.
  const size = pngPixelSize(layout, opts);
  if (!size.ok) throw new ExportSizeError(size);
  // The rasterizer gets the exact pixel size on the root (viewBox unchanged), so both sides are rounded from their own
  // physical size rather than the height following the rounded width (HEY-39). The SVG file itself keeps its units.
  const forRaster = composed.svg.replace(
    /^<svg ([^>]*?)width="[^"]*" height="[^"]*"/,
    `<svg $1width="${size.width}" height="${size.height}" preserveAspectRatio="none"`,
  );
  return {
    body: rasterizeSvg(forRaster, { width: size.width, fontFiles: CAPTION_FONT_FILES }),
    contentType: "image/png",
    scan: composed.scan,
    size,
  };
}
