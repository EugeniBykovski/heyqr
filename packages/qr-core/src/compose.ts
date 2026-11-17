import { circle, escapeXml, round3 as f, roundedRect } from "./geometry";
import { renderQr } from "./render";
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

/** Caption font size in layout units, shrunk to fit its box. */
export function captionFontSize(layout: Layout, g: LayoutGeometry): number {
  const lines = String(layout.caption.text || "").split("\n");
  if (!g.caption) return 0;
  if (layout.preset === "frame") {
    const longest = Math.max(1, ...lines.map((t) => t.length));
    return Math.min(((g.caption[3] * 0.5) / lines.length) * 1.1, (g.caption[2] * 0.86) / (longest * 0.56));
  }
  const base = layout.unit === "px" ? layout.caption.size : layout.caption.size * 0.3528;
  const first = (lines[0] ?? "").length;
  const sub = Math.max(0, ...lines.slice(1).map((t) => t.length));
  const fitW = (g.caption[2] * 0.94) / Math.max(1, first * 0.56, sub * 0.56 * 0.74);
  const fitH = (g.caption[3] * 0.86) / (1.18 * (1 + (lines.length - 1) * 0.74));
  return Math.min(base, fitW, fitH);
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
export function composeLayout(layout: Layout, value: string, options: ComposeOptions = {}): ComposedLayout {
  const g = layoutGeometry(layout);
  const col = layout.colors;
  const cap = layout.caption;
  const inCode = cap.position === "center" && Boolean(cap.text);
  const qr = renderQr(value, {
    ...layout.style,
    colors: { fg: col.fg, eye: col.eye, eyeIn: col.eyeIn, bg: col.bg },
    centerText: inCode ? { text: cap.text.split("\n")[0] ?? "", bg: col.fg, color: col.bg, fontFamily: cap.fontFamily } : null,
  });
  // The scan check always uses the real background; a transparent export only drops the fill.
  const qrInner = options.transparent ? qr.inner.replace(`fill="${col.bg}"/>`, 'fill="none"/>') : qr.inner;

  const W = g.width;
  const H = g.height;
  const unit = layout.unit === "px" ? "" : "mm";
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}${unit}" height="${f(H)}${unit}" viewBox="0 0 ${f(W)} ${f(H)}">`;

  if (g.frame) {
    for (const p of g.frame.paths) {
      const fill = p.fill === "bg" ? (options.transparent ? "none" : col.bg) : col.frame;
      svg += `<path d="${p.d}" fill="${fill}"/>`;
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
    const fs = captionFontSize(layout, g);
    const fs2 = fs * 0.74;
    const lines = cap.text.split("\n");
    const align = g.frame ? "center" : cap.align;
    const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
    const tx = align === "left" ? g.caption[0] : align === "right" ? g.caption[0] + g.caption[2] : g.caption[0] + g.caption[2] / 2;
    const total = fs * 1.15 + (lines.length - 1) * fs2 * 1.3;
    const ty = g.caption[1] + g.caption[3] / 2 - total / 2 + fs * 0.85;
    svg += `<text font-family="${escapeXml(cap.fontFamily)}" fill="${col.caption}" text-anchor="${anchor}">`;
    lines.forEach((line, i) => {
      const y = i === 0 ? ty : ty + fs * 0.3 + i * fs2 * 1.3;
      svg += `<tspan x="${f(tx)}" y="${f(y)}" font-size="${f(i === 0 ? fs : fs2)}" font-weight="${i === 0 ? cap.weight : 400}"${i === 0 ? "" : ' fill-opacity="0.72"'}>${escapeXml(line)}</tspan>`;
    });
    svg += "</text>";
  }

  if (g.top && layout.topLogoHref) {
    svg += `<image href="${escapeXml(layout.topLogoHref)}" x="${f(g.top[0])}" y="${f(g.top[1])}" width="${f(g.top[3])}" height="${f(g.top[3])}"/>`;
    if (layout.brandName) {
      svg += `<text x="${f(g.top[0] + g.top[3] * 1.25)}" y="${f(g.top[1] + g.top[3] * 0.62)}" font-family="${escapeXml(cap.fontFamily)}" font-size="${f(g.top[3] * 0.32)}" font-weight="700" fill="${col.caption}">${escapeXml(layout.brandName)}</text>`;
    }
  }

  svg += "</svg>";
  return { svg, width: W, height: H, scan: qr.scan };
}
