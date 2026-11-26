import "server-only";
import { isHostedContent, type AnyQrContent } from "@/entities/qr/model/hosted";
import {
  captionWeightFor,
  imageAspect,
  type CaptionWeight,
  captionFaces,
  composeLayout,
  encodePayload,
  PNG_MAX_SIDE,
  PNG_MIN_SIDE,
  PNG_DEFAULTS,
  pngPixelSize,
  type Layout,
  type PngResolution,
} from "@heyqr/qr-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { env } from "@/env";
import { PREVIEW_SLUG, shortLinkUrl } from "@/shared/lib/short-link";

export type ExportFormat = "png" | "svg";

/** Caption font files (HEY-44): the same files the browser preview loads from /caption-fonts. Traced via next.config.ts. */
export const CAPTION_FONT_DIR = path.join(process.cwd(), "public/caption-fonts");

/** The caption's font faces (family, weight, file) for a layout: none when it shows no caption. */
export function captionFontFaces(layout: Layout): { family: string; weight: number; file: string }[] {
  // The brand card's name (design 2.8) is drawn bold in the caption's font, also when there is no caption.
  const brand = Boolean(layout.topLogoHref && layout.brandName?.trim()) && layout.preset !== "qr";
  if ((!layout.caption.text || layout.preset === "qr") && !brand) return [];
  const { font, weights: lineWeights } = captionFaces(layout.caption);
  const bold = (layout.caption.font ? captionWeightFor(layout.caption.font, 700) : 700) as CaptionWeight;
  const weights = [
    ...new Set([...(layout.caption.text && layout.preset !== "qr" ? lineWeights : []), ...(brand && font.faces[bold] ? [bold] : [])]),
  ];
  return weights.flatMap((weight) => {
    const file = font.faces[weight];
    return file ? [{ family: font.family, weight, file: path.join(CAPTION_FONT_DIR, file) }] : [];
  });
}

/**
 * A downloaded SVG must look the same without the app, its network or locally installed fonts: the caption's faces
 * are embedded as @font-face data URLs (the OFL allows embedding the fonts in documents). resvg ignores this block and
 * gets the same files directly.
 */
export function withEmbeddedFonts(svg: string, faces: { family: string; weight: number; file: string }[]): string {
  if (faces.length === 0 || !svg.includes("<text")) return svg;
  const css = faces
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;src:url(data:font/ttf;base64,${readFileSync(f.file).toString("base64")}) format('truetype')}`,
    )
    .join("");
  return svg.replace(/^(<svg [^>]*>)/, `$1<defs><style>${css}</style></defs>`);
}

/** What the printed code contains: the payload for static codes, the permanent short link for dynamic ones. */
/**
 * The download's file name (Content-Disposition). Header values must be Latin-1, so the name is sent twice (RFC 6266):
 * an ASCII `filename` fallback and the real name as UTF-8 in `filename*`. A Cyrillic name used to throw here.
 */
export function downloadFileName(name: string, ext: string): { name: string; header: string } {
  const slug =
    name
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}\- ]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "qr-code";
  const ascii =
    slug
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "qr-code";
  const file = `${slug}.${ext}`;
  return { name: file, header: `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(file)}` };
}

/**
 * What the code holds. Static: its serialized content. Dynamic: its issued short link, never the destination itself.
 * HEY-118: a Dynamic draft without a slug shows the same preview link as Create (isShortLinkPreview); its files can't
 * be downloaded until activation issues the slug (canDownload).
 */
export function encodedValue(qr: { model: "static" | "dynamic"; content: AnyQrContent; shortCode: string | null }) {
  // Hosted pages are always Dynamic: the code holds the short link and the page lives behind it.
  if (qr.model === "dynamic" || isHostedContent(qr.content))
    return shortLinkUrl(env.NEXT_PUBLIC_SHORT_LINK_BASE, qr.shortCode ?? PREVIEW_SLUG);
  return encodePayload(qr.content);
}

/** HEY-118: a Dynamic code shown before activation encodes the preview link, not a link a scan can follow. */
export const isShortLinkPreview = (qr: { model: "static" | "dynamic"; shortCode: string | null }) =>
  qr.model === "dynamic" && !qr.shortCode;

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
 * Exported files must be self-contained (and resvg can't fetch URLs). HEY-83: stored logos arrive here already
 * resolved from private storage as data URIs (server/qr/repository.ts); nothing is ever fetched from a URL, so any
 * other href is left out of the file.
 */
async function embed(href: string | undefined): Promise<string | undefined> {
  return href?.startsWith("data:") ? href : undefined;
}

export async function withEmbeddedImages(layout: Layout): Promise<Layout> {
  const logo = layout.style.logo;
  const art = layout.style.art;
  const [logoHref, topLogoHref, artImage] = await Promise.all([embed(logo?.href), embed(layout.topLogoHref), embed(art?.image)]);
  return {
    ...layout,
    // The aspect ratio the browser preview used (read from the stored href), so embedding never changes the card.
    ...(layout.topLogoHref ? { topLogoAspect: layout.topLogoAspect ?? imageAspect(layout.topLogoHref) ?? 1 } : {}),
    topLogoHref,
    style: { ...layout.style, logo: logo ? { ...logo, href: logoHref } : logo, art: art ? { ...art, image: artImage } : art },
  };
}

export async function renderExport(
  layout: Layout,
  value: string,
  format: ExportFormat,
  opts: { dpi?: number; scale?: number; transparent?: boolean },
) {
  const composed = composeLayout(await withEmbeddedImages(layout), value, { transparent: opts.transparent });
  const faces = captionFontFaces(layout);
  if (format === "svg")
    return { body: Buffer.from(withEmbeddedFonts(composed.svg, faces)), contentType: "image/svg+xml", scan: composed.scan };
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
    // HEY-180: print layouts carry their dpi in the file, so they open at their physical size.
    body: rasterizeSvg(forRaster, {
      width: size.width,
      fontFiles: faces.map((f) => f.file),
      ...(layout.unit === "mm" ? { dpi: opts.dpi ?? PNG_DEFAULTS.dpi } : {}),
    }),
    contentType: "image/png",
    scan: composed.scan,
    size,
  };
}
