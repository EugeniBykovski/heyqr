import { createHash } from "node:crypto";
import { brandHeader, composeLayout, layoutGeometry, type Layout } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import {
  effectivePpi,
  MIN_LOGO_PPI,
  MIN_PRINT_QR_MM,
  pixelsNeeded,
  printColors,
  printSizes,
  srgbOf,
  type PrintSettings,
} from "../../entities/qr/model/print";
import { captionFontFaces } from "../qr/export";

/*
 * Design 8.x / Handoff · Commerce §4 "Print Preview contract": the preview and the print files come from one function,
 * keyed by the saved layout revision and the print settings (renderKey). The page is the layout at its finished size,
 * the background carried into the bleed, and crop marks; the PDF is that page as vector with the caption fonts
 * embedded. Colours stay sRGB: CMYK needs ICC conversion, which this deployment doesn't have.
 * Plain module (no "server-only") so tests render the same files as the routes.
 */
const MM_TO_PT = 72 / 25.4;
const f = (v: number) => Number(v.toFixed(3)).toString();

/** Width and height of a PNG, JPEG or WebP data URL from its header, or null (SVG and unknown formats). */
export function rasterSize(href: string | undefined): { width: number; height: number } | null {
  const m = href?.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
  if (!m?.[2]) return null;
  const b = Buffer.from(m[2], "base64");
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] ?? 0;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

export type PrintWarning = { code: "logo_low_ppi"; ppi: number; needPx: number } | { code: "qr_small"; qrMm: number };

export interface PrintPage {
  svg: string;
  sizes: ReturnType<typeof printSizes>;
  colors: { role: string; roles: string[]; hex: string; srgb: string }[];
  logo: { raster: boolean; px: number | null; ppi: number | null; mm: number } | null;
  warnings: PrintWarning[];
  renderKey: string;
  scanOk: boolean;
}

export const renderKeyOf = (layoutId: string, revision: string, s: PrintSettings) =>
  createHash("sha256")
    .update(`${layoutId}|${revision}|${JSON.stringify([s.scale, s.bleed, s.cropMarks, s.profile])}`)
    .digest("hex")
    .slice(0, 20);

/** The print page of a layout, its sizes, colours, logo resolution and warnings. `layout` has its images embedded. */
export function printPage(layout: Layout, value: string, s: PrintSettings, key: { layoutId: string; revision: string }): PrintPage {
  const sizes = printSizes(layout, s);
  const g = layoutGeometry(layout);
  const composed = composeLayout(layout, value);
  // The layout as a nested SVG at the finished size; its own viewBox keeps every part in proportion.
  const nested = composed.svg.replace(
    /^<svg [^>]*?viewBox="([^"]+)"[^>]*>/,
    (_m, vb: string) =>
      `<svg x="${f(sizes.trim.x)}" y="${f(sizes.trim.y)}" width="${f(sizes.finished.width)}" height="${f(sizes.finished.height)}" viewBox="${vb}">`,
  );
  const { width: W, height: H } = sizes.page;
  const { x: tx, y: ty } = sizes.trim;
  const fw = sizes.finished.width;
  const fh = sizes.finished.height;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">`;
  if (s.bleed > 0)
    svg += `<rect x="${f(tx - s.bleed)}" y="${f(ty - s.bleed)}" width="${f(fw + 2 * s.bleed)}" height="${f(fh + 2 * s.bleed)}" fill="${layout.colors.bg}"/>`;
  svg += nested;
  if (s.cropMarks) {
    const len = 5;
    const gap = s.bleed + 1;
    const d: string[] = [];
    for (const x of [tx, tx + fw])
      d.push(`M${f(x)} ${f(ty - gap)}V${f(ty - gap - len)}`, `M${f(x)} ${f(ty + fh + gap)}V${f(ty + fh + gap + len)}`);
    for (const y of [ty, ty + fh])
      d.push(`M${f(tx - gap)} ${f(y)}H${f(tx - gap - len)}`, `M${f(tx + fw + gap)} ${f(y)}H${f(tx + fw + gap + len)}`);
    // 0.25 pt registration lines.
    svg += `<path d="${d.join("")}" fill="none" stroke="#000000" stroke-width="0.0882"/>`;
  }
  svg += "</svg>";

  // Logo resolution at the finished size: the logo box is a share of the symbol's modules; vector logos never warn.
  const logo = layout.style.logo;
  const href = logo?.href ?? layout.topLogoHref;
  const warnings: PrintWarning[] = [];
  let logoInfo: PrintPage["logo"] = null;
  if (href) {
    const total = Number(composed.svg.match(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" viewBox="0 0 (\d+)/)?.[1] ?? 0);
    const header = logo?.href ? null : brandHeader(layout, g);
    // The brand card logo's longest side as drawn (its bounded box keeps the image's aspect ratio).
    const mm =
      logo?.href && total > 8
        ? ((logo.size * (total - 8)) / total) * g.qr[2] * s.scale
        : (header ? Math.max(header.logo[2], header.logo[3]) : g.qr[2] * 0.3) * s.scale;
    const px = rasterSize(href);
    const longest = px ? Math.max(px.width, px.height) : null;
    const ppi = longest ? effectivePpi(longest, mm) : null;
    logoInfo = { raster: px !== null, px: longest, ppi, mm: Math.round(mm * 10) / 10 };
    if (ppi !== null && ppi < MIN_LOGO_PPI) warnings.push({ code: "logo_low_ppi", ppi, needPx: pixelsNeeded(mm) });
  }
  // An icon from the library is vector: it is reported as a logo that is sharp at any size (design: "Vector").
  if (!href && logo?.iconPath) {
    const total = Number(composed.svg.match(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" viewBox="0 0 (\d+)/)?.[1] ?? 0);
    const mm = total > 8 ? ((logo.size * (total - 8)) / total) * g.qr[2] * s.scale : g.qr[2] * logo.size * s.scale;
    logoInfo = { raster: false, px: null, ppi: null, mm: Math.round(mm * 10) / 10 };
  }
  if (sizes.qr < MIN_PRINT_QR_MM) warnings.push({ code: "qr_small", qrMm: sizes.qr });
  return {
    svg,
    sizes,
    colors: printColors(layout).map((c) => ({ ...c, srgb: srgbOf(c.hex) })),
    logo: logoInfo,
    warnings,
    renderKey: renderKeyOf(key.layoutId, key.revision, s),
    scanOk: composed.scan.ok,
  };
}

/** SVG and WebP images become PNG for the PDF (PDFKit embeds PNG and JPEG); 2400 px covers 200 mm at 300 ppi. */
function pdfReadyImages(svg: string): string {
  return svg.replace(/href="(data:image\/(?:svg\+xml|webp);base64,[^"]+)"/g, (_m, href: string) => {
    const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2400" viewBox="0 0 100 100"><image href="${href}" width="100" height="100" preserveAspectRatio="xMidYMid meet"/></svg>`;
    return `href="data:image/png;base64,${rasterizeSvg(wrapper, { width: 2400 }).toString("base64")}"`;
  });
}

async function pdfBuffer(size: [number, number], build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size, margin: 0, pdfVersion: "1.7", info: { Producer: "HeyQR", Creator: "HeyQR" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  build(doc);
  doc.end();
  return done;
}

/**
 * HEY-69: the page boxes print-shop software reads. TrimBox is the finished size (where the crop marks point), BleedBox
 * the trim plus bleed; both centred on the page (room for the marks around them). PDF points, origin bottom left.
 */
export function printBoxes(sizes: PrintPage["sizes"], bleed: number): { trim: number[]; bleed: number[] } {
  const box = (inset: number) =>
    [inset, inset, sizes.page.width - inset, sizes.page.height - inset].map((mm) => Math.round(mm * MM_TO_PT * 1000) / 1000);
  return { trim: box(sizes.trim.x), bleed: box(sizes.trim.x - bleed) };
}

/** The print PDF: the page as vector, caption fonts embedded, sRGB (untagged DeviceRGB), with TrimBox and BleedBox. */
export async function printPdf(layout: Layout, page: PrintPage, bleed: number): Promise<Buffer> {
  const faces = captionFontFaces(layout);
  const W = page.sizes.page.width * MM_TO_PT;
  const H = page.sizes.page.height * MM_TO_PT;
  const boxes = printBoxes(page.sizes, bleed);
  return pdfBuffer([W, H], (doc) => {
    const pageDict = doc.page.dictionary.data as Record<string, unknown>;
    pageDict.TrimBox = boxes.trim;
    pageDict.BleedBox = boxes.bleed;
    SVGtoPDF(doc, pdfReadyImages(page.svg), 0, 0, {
      width: W,
      height: H,
      fontCallback: (family, bold) => {
        const face =
          faces.find((x) => family.includes(x.family) && (bold ? x.weight >= 600 : x.weight < 600)) ??
          faces.find((x) => family.includes(x.family)) ??
          faces[0];
        return face?.file ?? "Helvetica";
      },
    });
  });
}

export type SpecLabels = Record<
  "title" | "finished" | "page" | "bleed" | "marks" | "qr" | "profile" | "srgb" | "logo" | "vector" | "colors" | "key" | "yes" | "no",
  string
> &
  Record<string, string>;

/** The specifications sheet (design "Color and size sheet"): A4, the sizes and colour values of this print. */
export async function printSpecPdf(
  page: PrintPage,
  meta: { name: string; layoutName: string; settings: PrintSettings; fontFile: string; boldFile: string },
  labels: SpecLabels,
): Promise<Buffer> {
  return pdfBuffer([595.28, 841.89], (doc) => {
    doc.registerFont("body", meta.fontFile);
    doc.registerFont("bold", meta.boldFile);
    const x = 56;
    let y = 64;
    const row = (k: string, v: string) => {
      doc.font("body").fontSize(10).fillColor("#5F5F68").text(k, x, y, { width: 170 });
      doc
        .font("bold")
        .fontSize(10)
        .fillColor("#0D0D12")
        .text(v, x + 180, y, { width: 300 });
      y += 22;
    };
    doc.font("bold").fontSize(20).fillColor("#0D0D12").text(labels.title, x, y);
    y += 30;
    doc.font("body").fontSize(11).fillColor("#5F5F68").text(`${meta.name} · ${meta.layoutName}`, x, y);
    y += 34;
    const s = page.sizes;
    row(labels.finished, `${s.finished.width} × ${s.finished.height} mm`);
    row(labels.page, `${s.page.width} × ${s.page.height} mm`);
    row(labels.bleed, `${meta.settings.bleed} mm`);
    row(labels.marks, meta.settings.cropMarks ? labels.yes : labels.no);
    row(labels.qr, `${s.qr} mm`);
    row(labels.profile, labels.srgb);
    if (page.logo) row(labels.logo, page.logo.ppi ? `${page.logo.ppi} ppi` : labels.vector);
    y += 12;
    doc.font("bold").fontSize(12).fillColor("#0D0D12").text(labels.colors, x, y);
    y += 22;
    for (const c of page.colors) {
      doc.rect(x, y - 2, 16, 16).fillAndStroke(c.hex, "#C9C9D1");
      doc
        .font("body")
        .fontSize(10)
        .fillColor("#0D0D12")
        .text(`${c.roles.map((r) => labels[`role_${r}`] ?? r).join(", ")}   ${c.hex}   sRGB ${c.srgb}`, x + 26, y, { width: 460 });
      y += 24;
    }
    y += 16;
    doc.font("body").fontSize(9).fillColor("#5F5F68").text(`${labels.key} ${page.renderKey}`, x, y);
  });
}

/**
 * Design 3.x "PDF · Vector for print shops": the layout itself as a one-page vector PDF at its own size (mm layouts in
 * mm, screen layouts at 96 px per inch), caption fonts embedded, sRGB. No bleed or crop marks (that's the Print Pack).
 */
export async function layoutPdf(
  layout: Layout,
  value: string,
  options: { transparent?: boolean } = {},
): Promise<{ body: Buffer; scanOk: boolean }> {
  const composed = composeLayout(layout, value, { transparent: options.transparent });
  const g = layoutGeometry(layout);
  const toPt = layout.unit === "mm" ? MM_TO_PT : 0.75;
  const W = g.width * toPt;
  const H = g.height * toPt;
  const faces = captionFontFaces(layout);
  const body = await pdfBuffer([W, H], (doc) => {
    SVGtoPDF(doc, pdfReadyImages(composed.svg), 0, 0, {
      width: W,
      height: H,
      fontCallback: (family, bold) => {
        const face =
          faces.find((x) => family.includes(x.family) && (bold ? x.weight >= 600 : x.weight < 600)) ??
          faces.find((x) => family.includes(x.family)) ??
          faces[0];
        return face?.file ?? "Helvetica";
      },
    });
  });
  return { body, scanOk: composed.scan.ok };
}
