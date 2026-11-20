import { CAPTION_FONTS, captionFontFamily, captionWeightFor } from "./caption-fonts";
import { captionFaceFile, fitCaption, measureCaptionText, wrapCaptionLine, type CaptionLine } from "./caption-wrap";
import { circle, escapeXml, round3 as f, roundedRect } from "./geometry";
import { maxPayloadBytes, payloadBytes, type ErrorCorrectionLevel } from "./encode";
import { eclForStyle, renderQr } from "./render";
import type { FrameStyle, Layout, ScanReport } from "./types";

const rr = (x: number, y: number, w: number, h: number, r: number) => roundedRect(x, y, w, h, r);

/** Frame width/height as multiples of the QR size. Shared with the editor so previews keep exact proportions. */
export const FRAME_RATIOS: Record<FrameStyle, [number, number]> = {
  bar: [1.14, 1.44],
  tab: [1.14, 1.395],
  bubble: [1.14, 1.471],
  pill: [1.14, 1.365],
  corners: [1.224, 1.464],
  circle: [1.62, 1.62],
  ticket: [1.14, 1.47],
  phone: [1.196, 1.7],
};

/** Frames whose label sits on the frame color (label defaults to the background color). */
export const LABEL_ON_FRAME: Record<FrameStyle, boolean> = {
  bar: true,
  tab: true,
  bubble: true,
  pill: true,
  corners: false,
  circle: true,
  ticket: true,
  phone: false,
};

type Box = [number, number, number, number];
type FramePath = { fill: "frame" | "bg"; d: string };

interface FrameGeometry {
  width: number;
  height: number;
  qrX: number;
  qrY: number;
  paths: FramePath[];
  label: Box;
}

export function frameGeometry(style: FrameStyle, q: number): FrameGeometry {
  const [kw, kh] = FRAME_RATIOS[style];
  const W = kw * q;
  const H = kh * q;
  const p = q * 0.07;
  const r = q * 0.09;
  let qrX = p;
  let qrY = p;
  const paths: FramePath[] = [];
  let label: Box;
  switch (style) {
    case "tab": {
      const tb = 0.255 * q;
      qrY = tb + p;
      paths.push({ fill: "frame", d: rr(0, tb, W, H - tb, r * 1.5) });
      paths.push({ fill: "bg", d: rr(p * 0.5, tb + p * 0.5, W - p, q + p, r) });
      paths.push({ fill: "frame", d: roundedRect(W * 0.16, 0, W * 0.68, tb + r * 1.5, r * 1.2, r * 1.2, 0, 0) });
      label = [W * 0.16, 0, W * 0.68, tb];
      break;
    }
    case "bubble": {
      const c1 = 1.14 * q;
      paths.push({ fill: "frame", d: rr(0, 0, W, c1, r * 1.5) });
      paths.push({ fill: "bg", d: rr(p * 0.5, p * 0.5, W - p, q + p, r) });
      paths.push({
        fill: "frame",
        d:
          `M${f(W / 2 - p)} ${f(c1 - 0.2)}L${f(W / 2)} ${f(c1 + 0.11 * q)}L${f(W / 2 + p)} ${f(c1 - 0.2)}Z` +
          rr(W * 0.1, 1.231 * q, W * 0.8, 0.24 * q, 0.12 * q),
      });
      label = [W * 0.1, 1.231 * q, W * 0.8, 0.24 * q];
      break;
    }
    case "pill": {
      const h1 = 1.23 * q;
      paths.push({ fill: "frame", d: rr(0, 0, W, h1, r * 1.5) });
      paths.push({ fill: "bg", d: rr(p * 0.25, p * 0.25, W - p * 0.5, h1 - p * 0.5, r * 1.3) });
      paths.push({ fill: "frame", d: rr(W * 0.14, 1.095 * q, W * 0.72, 0.27 * q, 0.135 * q) });
      label = [W * 0.14, 1.095 * q, W * 0.72, 0.27 * q];
      break;
    }
    case "corners": {
      const S = 1.224 * q;
      const t = 0.035 * q;
      const l = 0.2 * q;
      qrX = qrY = 0.112 * q;
      paths.push({ fill: "bg", d: rr(0, 0, W, H, r) });
      paths.push({
        fill: "frame",
        d:
          `M0 0H${f(l)}V${f(t)}H${f(t)}V${f(l)}H0Z` +
          `M${f(W)} 0V${f(l)}H${f(W - t)}V${f(t)}H${f(W - l)}V0Z` +
          `M0 ${f(S)}V${f(S - l)}H${f(t)}V${f(S - t)}H${f(l)}V${f(S)}Z` +
          `M${f(W)} ${f(S)}H${f(W - l)}V${f(S - t)}H${f(W - t)}V${f(S - l)}H${f(W)}Z`,
      });
      label = [0, S + 0.01 * q, W, H - S - 0.02 * q];
      break;
    }
    case "circle": {
      qrX = 0.31 * q;
      qrY = 0.2754 * q;
      paths.push({ fill: "frame", d: circle(W / 2, W / 2, W / 2) });
      paths.push({ fill: "bg", d: rr(qrX - p * 0.5, qrY - p * 0.5, q + p, q + p, r) });
      label = [W * 0.22, 1.317 * q, W * 0.56, 0.21 * q];
      break;
    }
    case "ticket": {
      paths.push({ fill: "frame", d: rr(0, 0, W, H, r * 1.5) });
      paths.push({ fill: "bg", d: rr(p * 0.5, p * 0.5, W - p, q + p, r) });
      let dots = "";
      for (let x = W * 0.09; x < W * 0.92; x += 0.05 * q) dots += circle(x, 1.17 * q, 0.012 * q);
      paths.push({ fill: "bg", d: dots });
      label = [0, 1.2 * q, W, 0.27 * q];
      break;
    }
    case "phone": {
      qrX = 0.098 * q;
      qrY = 0.182 * q;
      paths.push({ fill: "frame", d: rr(0, 0, W, H, W * 0.17) });
      paths.push({ fill: "bg", d: rr(0.035 * q, 0.035 * q, W - 0.07 * q, H - 0.07 * q, W * 0.14) });
      paths.push({
        fill: "frame",
        d: rr(W * 0.36, 0.07 * q, W * 0.28, 0.035 * q, 0.0175 * q) + rr(W * 0.35, H - 0.08 * q, W * 0.3, 0.02 * q, 0.01 * q),
      });
      label = [qrX, 1.2 * q, q, 0.3 * q];
      break;
    }
    default: {
      paths.push({ fill: "frame", d: rr(0, 0, W, H, r * 1.5) });
      paths.push({ fill: "bg", d: rr(p * 0.5, p * 0.5, W - p, q + p, r) });
      label = [0, q + 1.5 * p, W, H - (q + 1.5 * p)];
    }
  }
  return { width: W, height: H, qrX, qrY, paths, label };
}

export interface LayoutGeometry {
  width: number;
  height: number;
  qr: [number, number, number];
  caption: Box | null;
  top: Box | null;
  frame: FrameGeometry | null;
}

/** Positions of QR, caption and top logo for a layout, in layout units. */
export function layoutGeometry(layout: Layout): LayoutGeometry {
  const cap = layout.caption;
  const inCode = cap.position === "center" && Boolean(cap.text);
  if (layout.preset === "frame") {
    const q = layout.qrSize;
    const g = frameGeometry(layout.frameStyle ?? "bar", q);
    return { width: g.width, height: g.height, qr: [g.qrX, g.qrY, q], caption: inCode ? null : g.label, top: null, frame: g };
  }
  const W = layout.width;
  const H = layout.height;
  const before = cap.position === "before";
  const top = Boolean(layout.topLogoHref);
  let q = Math.min(layout.qrSize, W, H);
  const out: LayoutGeometry = { width: W, height: H, qr: [0, 0, q], caption: null, top: null, frame: null };

  if (layout.preset === "qr" || (layout.preset === "caption" && inCode)) {
    out.width = out.height = q;
    out.qr = [0, 0, q];
  } else if (layout.preset === "caption") {
    q = Math.min(q, H * 0.9);
    const band = Math.max(H - q, 0);
    out.qr = [(W - q) / 2, before ? band : 0, q];
    out.caption = [W * 0.06, before ? 0 : q, W * 0.88, band];
  } else if (layout.preset === "vertical") {
    const hb = top ? H * 0.21 : H * 0.06;
    const cb = inCode ? H * 0.06 : H * 0.19;
    const mid = H - hb - cb;
    q = Math.min(q, mid, W * 0.9);
    if (top) out.top = [W * 0.1, H * 0.05, W * 0.8, hb - H * 0.06];
    const qy = before ? hb + cb + (mid - q) / 2 : hb + (mid - q) / 2;
    out.qr = [(W - q) / 2, qy, q];
    if (!inCode) out.caption = [W * 0.08, before ? hb : H - cb, W * 0.84, cb * 0.9];
  } else {
    const pad = (H - q) / 2;
    const qx = before ? W - pad - q : pad;
    const cx = before ? pad * 1.2 : pad + q + pad * 0.8;
    const cw = Math.max(W - q - pad * 3, W * 0.18);
    out.qr = [qx, pad, q];
    if (top) {
      out.top = [cx, pad, cw, q * 0.3];
      if (!inCode) out.caption = [cx, pad + q * 0.36, cw, q * 0.64];
    } else if (!inCode) {
      out.caption = [cx, pad, cw, q];
    }
  }
  return out;
}

/** Width ÷ height of an image from a data URL (PNG, JPEG, WebP header; SVG width/height or viewBox), or null. */
export function imageAspect(href: string | undefined): number | null {
  const m = href?.match(/^data:image\/([a-z+]+);base64,(.*)$/);
  if (!m?.[2]) return null;
  let bin: string;
  try {
    bin = atob(m[2].slice(0, m[1] === "svg+xml" ? 8192 : 65536));
  } catch {
    return null;
  }
  const byte = (i: number) => bin.charCodeAt(i) & 0xff;
  const u16 = (i: number) => (byte(i) << 8) | byte(i + 1);
  const u32 = (i: number) => byte(i) * 0x1000000 + ((byte(i + 1) << 16) | (byte(i + 2) << 8) | byte(i + 3));
  const ratio = (w: number, h: number) => (w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : null);
  if (m[1] === "svg+xml") {
    const tag = bin.match(/<svg\b[^>]*>/)?.[0] ?? "";
    const num = (a: string) => Number.parseFloat(tag.match(new RegExp(`\\s${a}="\\s*([\\d.]+)(?:px)?\\s*"`))?.[1] ?? "");
    const vb = tag.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
    return ratio(num("width"), num("height")) ?? (vb ? ratio(Number(vb[1]), Number(vb[2])) : null);
  }
  if (bin.length > 24 && bin.startsWith("\x89PNG")) return ratio(u32(16), u32(20));
  if (byte(0) === 0xff && byte(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bin.length) {
      if (byte(i) !== 0xff) return null;
      const marker = byte(i + 1);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ratio(u16(i + 7), u16(i + 5));
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (bin.startsWith("RIFF") && bin.slice(8, 12) === "WEBP") {
    const kind = bin.slice(12, 16);
    const le24 = (i: number) => byte(i) | (byte(i + 1) << 8) | (byte(i + 2) << 16);
    if (kind === "VP8X") return ratio(1 + le24(24), 1 + le24(27));
    if (kind === "VP8 ") return ratio(((byte(27) << 8) | byte(26)) & 0x3fff, ((byte(29) << 8) | byte(28)) & 0x3fff);
    if (kind === "VP8L") {
      const bits = byte(21) | (byte(22) << 8) | (byte(23) << 16) | (byte(24) << 24);
      return ratio((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
  }
  return null;
}

export interface BrandHeader {
  /** The logo's own box (x, y, width, height), its aspect ratio kept, inside the header band. */
  logo: Box;
  /** The brand name in the rest of the band: wrapped at most to two lines and sized to fit; null without a name. */
  name: { x: number; y: number; fs: number; lines: string[]; family: string; weight: number } | null;
}

/**
 * Design 2.8 "Brand card": the logo and name above the code. Both stay inside the header band (`g.top`): the logo gets
 * a bounded box (at most the band's height, at most 40 % of its width with a name) with its own aspect ratio; the name
 * is measured with the caption font's real advance widths and wrapped or reduced to the space beside the logo; the
 * pair is centred in the band. Every output (editor preview, PNG, SVG, print PDF) draws this same geometry.
 */
export function brandHeader(layout: Layout, g: LayoutGeometry): BrandHeader | null {
  if (!g.top || !layout.topLogoHref) return null;
  const [bx, by, bw, bh] = g.top;
  const aspect = Math.min(8, Math.max(1 / 8, layout.topLogoAspect ?? imageAspect(layout.topLogoHref) ?? 1));
  const name = (layout.brandName ?? "").replace(/\s+/g, " ").trim();
  const maxLogoW = name ? bw * 0.4 : bw;
  const lw = Math.min(maxLogoW, bh * aspect);
  const lh = lw / aspect;
  if (!name) return { logo: [bx + (bw - lw) / 2, by + (bh - lh) / 2, lw, lh], name: null };
  const gap = bh * 0.22;
  const room = bw - lw - gap;
  const font = layout.caption.font;
  const weight = font ? captionWeightFor(font, 700) : 700;
  const file = captionFaceFile(font, weight);
  // The largest size up to 36 % of the band whose lines (whole words first, split only if a word can't fit) fit the
  // room beside the logo in at most two lines, or in the band's height if more are needed. Every word is drawn.
  const wrapAt = (fs: number, split: boolean) =>
    wrapCaptionLine(name, room, (t) => measureCaptionText(t, file, fs), split).filter((l) => l !== "");
  const fits = (fs: number, split: boolean, maxLines: number) => {
    const lines = wrapAt(fs, split);
    return (
      lines.length <= maxLines &&
      lines.length * fs * 1.18 <= bh + 1e-9 &&
      lines.every((l) => measureCaptionText(l, file, fs) <= room + 1e-9)
    );
  };
  const largest = (split: boolean, maxLines: number) => {
    let lo = 0;
    let hi = bh * 0.36;
    if (fits(hi, split, maxLines)) return hi;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, split, maxLines)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const floor = bh * 0.14;
  const tries: [boolean, number][] = [
    [false, 2],
    [true, 2],
    [false, 3],
    [true, Number.POSITIVE_INFINITY],
  ];
  let fs = 0;
  let split = true;
  for (const [sp, max] of tries) {
    const size = largest(sp, max);
    if (size >= floor || max === Number.POSITIVE_INFINITY) {
      fs = size;
      split = sp;
      break;
    }
  }
  const lines = wrapAt(fs, split);
  const textW = Math.min(room, Math.max(...lines.map((t) => measureCaptionText(t, file, fs))));
  const x0 = bx + (bw - (lw + gap + textW)) / 2;
  const blockH = fs * 1.18 * lines.length;
  const family = font ? captionFontFamily(CAPTION_FONTS[font]) : layout.caption.fontFamily;
  return {
    logo: [x0, by + (bh - lh) / 2, lw, lh],
    name: { x: x0 + lw + gap, y: by + (bh - blockH) / 2 + fs * 0.92, fs, lines, family, weight },
  };
}

/** The caption band's base type size in layout units (px layouts: px; mm layouts: pt converted to mm). */
const captionBase = (layout: Layout) => (layout.unit === "px" ? layout.caption.size : layout.caption.size * 0.3528);

/**
 * The caption's lines and title size in layout units (HEY-47). Caption layouts wrap with the font's measured widths and
 * fit the band (caption-wrap.ts); a frame label keeps its explicit lines and sizes itself to the frame, as before.
 */
export function layoutCaptionLines(layout: Layout, g: LayoutGeometry): { fs: number; lines: CaptionLine[] } {
  const text = String(layout.caption.text || "");
  if (!g.caption || !text) return { fs: 0, lines: [] };
  const cap = layout.caption;
  if (layout.preset === "frame") {
    const parts = text.split("\n");
    // Average character width of the caption's font (HEY-44); older layouts keep the DM Sans estimate.
    const cw = cap.font ? CAPTION_FONTS[cap.font].charWidth : 0.56;
    const longest = Math.max(1, ...parts.map((t) => t.length));
    const fs = Math.min(((g.caption[3] * 0.5) / parts.length) * 1.1, (g.caption[2] * 0.86) / (longest * cw));
    const weight = cap.font ? captionWeightFor(cap.font, cap.weight) : cap.weight;
    return {
      fs,
      lines: parts.map((t, i) => ({ text: t, size: i === 0 ? fs : fs * 0.74, weight: i === 0 ? weight : 400, secondary: i > 0 })),
    };
  }
  return fitCaption(cap, captionBase(layout), g.caption[2], g.caption[3]);
}

/** Caption title size in layout units, after wrapping and fitting (what the editor reports as the drawn size). */
export function captionFontSize(layout: Layout, g: LayoutGeometry): number {
  return layoutCaptionLines(layout, g).fs;
}

export interface ComposedLayout {
  svg: string;
  width: number;
  height: number;
  scan: ScanReport;
}

export interface ComposeOptions {
  transparent?: boolean;
}

/**
 * Full layout SVG: frame or card, QR symbol, caption and top logo.
 * The editor preview and the paid export both call this, so the file matches the preview exactly.
 */
/** The QR style a layout renders with (shared by composeLayout and the capacity check, so both use the same ECL). */
function layoutQrStyle(layout: Layout) {
  const col = layout.colors;
  const cap = layout.caption;
  const inCode = cap.position === "center" && Boolean(cap.text);
  return {
    ...layout.style,
    colors: { fg: col.fg, eye: col.eye, eyeIn: col.eyeIn, bg: col.bg },
    centerText: inCode ? { text: cap.text.split("\n")[0] ?? "", bg: col.fg, color: col.bg, fontFamily: cap.fontFamily } : null,
  };
}

export type QrCapacity = {
  ok: boolean;
  /** UTF-8 bytes of the value that is actually encoded (escaping, folding and multibyte characters included). */
  bytes: number;
  /** The most this layout's QR can hold (byte mode, version 40 is not used: MAX_VERSION). */
  maxBytes: number;
  ecl: ErrorCorrectionLevel;
  /** A logo or in-code caption raises error correction to H, which roughly halves the capacity. */
  centerCovered: boolean;
};

/**
 * Whether `value` fits the QR this layout renders, decided by the encoder's own limits. Check this before
 * composeLayout/renderQr so a too-long value becomes a message, not an exception.
 */
export function layoutCapacity(layout: Layout, value: string): QrCapacity {
  const style = layoutQrStyle(layout);
  const ecl = eclForStyle(style);
  const bytes = payloadBytes(value);
  const maxBytes = maxPayloadBytes(ecl);
  return { ok: bytes <= maxBytes, bytes, maxBytes, ecl, centerCovered: ecl === "H" };
}

export function composeLayout(layout: Layout, value: string, options: ComposeOptions = {}): ComposedLayout {
  const g = layoutGeometry(layout);
  const col = layout.colors;
  const cap = layout.caption;
  const qr = renderQr(value, layoutQrStyle(layout));
  // The scan check always uses the real background; a transparent export only drops the fill.
  const qrInner = options.transparent ? qr.inner.replace(`fill="${col.bg}"/>`, 'fill="none"/>') : qr.inner;

  const W = g.width;
  const H = g.height;
  const unit = layout.unit === "px" ? "" : "mm";
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}${unit}" height="${f(H)}${unit}" viewBox="0 0 ${f(W)} ${f(H)}">`;

  if (g.frame) {
    const paths = g.frame.paths;
    if (!options.transparent) {
      for (const p of paths) svg += `<path d="${p.d}" fill="${p.fill === "bg" ? col.bg : col.frame}"/>`;
    } else {
      // Transparent export: a "bg" window painted over the frame colour would just become fill="none", and the frame
      // colour would show through the code and its quiet zone (HEY-27). Every frame-coloured shape is masked by the
      // symbol box (matrix + 4-module quiet zone) and by the windows drawn after it, so both become real holes.
      // Opaque output is unchanged: there the symbol's own background already covers that area.
      const symbolBox = `<rect x="${f(g.qr[0])}" y="${f(g.qr[1])}" width="${f(g.qr[2])}" height="${f(g.qr[2])}" fill="#000"/>`;
      let defs = "";
      let body = "";
      paths.forEach((p, i) => {
        if (p.fill === "bg") return;
        const windows = paths.slice(i + 1).filter((w) => w.fill === "bg");
        const id = `hq-frame-cut-${i}`;
        defs +=
          `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${f(W)}" height="${f(H)}">` +
          `<rect width="${f(W)}" height="${f(H)}" fill="#fff"/>${symbolBox}${windows.map((w) => `<path d="${w.d}" fill="#000"/>`).join("")}</mask>`;
        body += `<path d="${p.d}" fill="${col.frame}" mask="url(#${id})"/>`;
      });
      svg += (defs ? `<defs>${defs}</defs>` : "") + body;
    }
  } else {
    const card = layout.preset === "vertical" || layout.preset === "horizontal";
    const border = (layout.border || card) && layout.preset !== "qr";
    const bw = border ? Math.max(W * 0.0035, 0.3) : 0;
    const radius = card ? Math.min(W, H) * 0.06 : 0;
    svg += `<rect x="${f(bw / 2)}" y="${f(bw / 2)}" width="${f(W - bw)}" height="${f(H - bw)}" rx="${f(radius)}" fill="${options.transparent ? "none" : col.bg}"${border ? ` stroke="${col.frame}" stroke-width="${f(bw)}"` : ""}/>`;
  }

  svg += `<svg x="${f(g.qr[0])}" y="${f(g.qr[1])}" width="${f(g.qr[2])}" height="${f(g.qr[2])}" viewBox="0 0 ${qr.viewBox} ${qr.viewBox}">${qrInner}</svg>`;

  if (g.caption && cap.text) {
    // HEY-47: lines come wrapped and sized from the shared measurement, so every output breaks them identically.
    const { fs, lines } = layoutCaptionLines(layout, g);
    const align = g.frame ? "center" : cap.align;
    const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
    const tx = align === "left" ? g.caption[0] : align === "right" ? g.caption[0] + g.caption[2] : g.caption[0] + g.caption[2] / 2;
    // Baselines: title lines 1.15 × fs apart; the first secondary line 0.3 fs + 1.3 × its size below; then 1.3 × its size.
    const ys: number[] = [];
    let y = 0;
    lines.forEach((line, i) => {
      const prev = lines[i - 1];
      if (prev) y += line.secondary ? (prev.secondary ? line.size * 1.3 : fs * 0.3 + line.size * 1.3) : fs * 1.15;
      ys.push(y);
    });
    const total = lines.reduce((sum, l, i) => sum + (i === 0 ? fs * 1.15 : l.secondary ? l.size * 1.3 : fs * 1.15), 0);
    const ty = g.caption[1] + g.caption[3] / 2 - total / 2 + fs * 0.85;
    // HEY-44: a caption font ID draws with that font's shipped static faces (same files in the browser, resvg and the
    // SVG's embedded @font-face), at the nearest weight it ships. Older layouts keep their family string and DM Sans
    // with the optical size pinned (HEY-43), exactly as they were exported.
    const face = cap.font ? CAPTION_FONTS[cap.font] : null;
    const family = face ? captionFontFamily(face) : cap.fontFamily;
    const firstWeight = cap.font ? captionWeightFor(cap.font, cap.weight) : cap.weight;
    // Inline previews inherit the page's text settings (the app sets stylistic set 1 on body); the caption resets
    // them so every host draws the same glyphs as the exported files.
    const textStyle = face
      ? ` style="font-feature-settings:normal;font-variant:normal;letter-spacing:normal;word-spacing:normal;font-synthesis:none"`
      : ` style="font-variation-settings:'opsz' 14"`;
    svg += `<text font-family="${escapeXml(family)}" fill="${col.caption}" text-anchor="${anchor}"${textStyle}>`;
    lines.forEach((line, i) => {
      svg += `<tspan x="${f(tx)}" y="${f(ty + (ys[i] ?? 0))}" font-size="${f(line.size)}" font-weight="${line.secondary ? 400 : firstWeight}"${line.secondary ? ' fill-opacity="0.72"' : ""}>${escapeXml(line.text)}</tspan>`;
    });
    svg += "</text>";
  }

  const header = brandHeader(layout, g);
  if (header && layout.topLogoHref) {
    const [lx, ly, lw, lh] = header.logo;
    svg += `<image href="${escapeXml(layout.topLogoHref)}" x="${f(lx)}" y="${f(ly)}" width="${f(lw)}" height="${f(lh)}" preserveAspectRatio="xMidYMid meet"/>`;
    if (header.name) {
      const n = header.name;
      const textStyle = cap.font
        ? ` style="font-feature-settings:normal;font-variant:normal;letter-spacing:normal;word-spacing:normal;font-synthesis:none"`
        : "";
      svg += `<text font-family="${escapeXml(n.family)}" font-weight="${n.weight}" fill="${col.caption}"${textStyle}>`;
      n.lines.forEach((line, i) => {
        svg += `<tspan x="${f(n.x)}" y="${f(n.y + i * n.fs * 1.18)}" font-size="${f(n.fs)}">${escapeXml(line)}</tspan>`;
      });
      svg += "</text>";
    }
  }

  svg += "</svg>";
  return { svg, width: W, height: H, scan: qr.scan };
}

/* PNG export resolution (HEY-37). Screen layouts render at a scale of their px size, print layouts at a DPI of their
 * mm size; the whole layout is rasterized, keeping its aspect ratio (height rounded like resvg's fit-to-width). */

/** Resolutions offered for PNG (design export screen): 1×–8× for px layouts, 300–1200 dpi for mm layouts. */
export const PNG_SCALES = [1, 2, 4, 8] as const;
export const PNG_DPIS = [300, 600, 1200] as const;
export const PNG_DEFAULTS = { scale: 2, dpi: 300 } as const;
/** Export limits: no side smaller than 64 px or larger than 8192 px. */
export const PNG_MIN_SIDE = 64;
export const PNG_MAX_SIDE = 8192;

export type PngResolution = { scale?: number; dpi?: number };

/** Exact pixel size of the PNG for a layout at a resolution, and whether it is within the export limits. */
export function pngPixelSize(layout: Layout, resolution: PngResolution = {}): { width: number; height: number; ok: boolean } {
  const g = layoutGeometry(layout);
  // Each side is rounded from its own size (HEY-39): a print PNG has exactly the pixels of its physical size at the DPI.
  const factor = layout.unit === "mm" ? (resolution.dpi ?? PNG_DEFAULTS.dpi) / 25.4 : (resolution.scale ?? PNG_DEFAULTS.scale);
  const width = Math.round(g.width * factor);
  const height = Math.round(g.height * factor);
  const ok = Math.min(width, height) >= PNG_MIN_SIDE && Math.max(width, height) <= PNG_MAX_SIDE;
  return { width, height, ok };
}
