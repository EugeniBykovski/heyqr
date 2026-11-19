import { contrastRatio, luminance } from "./color";
import { encodeQr, type ErrorCorrectionLevel, type QrMatrix } from "./encode";
import { circle, diamond, escapeXml, round3 as f, roundedRect as rr } from "./geometry";
import type { EyeBallShape, EyeFrameShape, ModuleShape, QrStyle, RenderedQr, ScanIssue, ScanReport } from "./types";

const QUIET = 4;

type Excavation = { shape: "circle" | "square" | "rect"; size: number; halfW: number; halfH: number; pad: number };

function moduleShapes(m: QrMatrix, pattern: ModuleShape, on: (x: number, y: number) => boolean): string {
  const n = m.size;
  const q = QUIET;
  const out: string[] = [];
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && on(x, y);

  if (pattern === "vbars" || pattern === "hbars") {
    const vertical = pattern === "vbars";
    for (let a = 0; a < n; a++) {
      let b = 0;
      while (b < n) {
        const hit = vertical ? has(a, b) : has(b, a);
        if (!hit) {
          b++;
          continue;
        }
        const start = b;
        while (b < n && (vertical ? has(a, b) : has(b, a))) b++;
        const len = b - start;
        out.push(
          vertical
            ? rr(q + a + 0.12, q + start + 0.06, 0.76, len - 0.12, 0.38)
            : rr(q + start + 0.06, q + a + 0.12, len - 0.12, 0.76, 0.38),
        );
      }
    }
    return out.join("");
  }

  for (let y = 0; y < n; y++) {
    if (pattern === "square") {
      let x = 0;
      while (x < n) {
        if (!has(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < n && has(x, y)) x++;
        out.push(`M${q + start} ${q + y}h${x - start}v1h${start - x}z`);
      }
      continue;
    }
    for (let x = 0; x < n; x++) {
      if (!has(x, y)) continue;
      const X = q + x;
      const Y = q + y;
      switch (pattern) {
        case "dot":
          out.push(circle(X + 0.5, Y + 0.5, 0.45));
          break;
        case "diamond":
          out.push(diamond(X + 0.5, Y + 0.5, 0.48));
          break;
        case "leaf":
          out.push(rr(X + 0.04, Y + 0.04, 0.92, 0.92, 0.46, 0, 0.46, 0));
          break;
        case "fluid": {
          const up = has(x, y - 1);
          const dn = has(x, y + 1);
          const lf = has(x - 1, y);
          const rt = has(x + 1, y);
          out.push(rr(X, Y, 1, 1, !up && !lf ? 0.5 : 0, !up && !rt ? 0.5 : 0, !dn && !rt ? 0.5 : 0, !dn && !lf ? 0.5 : 0));
          break;
        }
        default:
          out.push(rr(X + 0.06, Y + 0.06, 0.88, 0.88, 0.3));
      }
    }
  }
  return out.join("");
}

function eyeFramePath(shape: EyeFrameShape, x: number, y: number): string {
  switch (shape) {
    case "circle":
      return circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5);
    case "rounded":
      return rr(x, y, 7, 7, 2.2) + rr(x + 1, y + 1, 5, 5, 1.5);
    case "cushion":
      return rr(x, y, 7, 7, 3.2) + rr(x + 1, y + 1, 5, 5, 2.4);
    case "leaf":
      return rr(x, y, 7, 7, 3.2, 0, 3.2, 0) + rr(x + 1, y + 1, 5, 5, 2.2, 0, 2.2, 0);
    default:
      return rr(x, y, 7, 7, 0) + rr(x + 1, y + 1, 5, 5, 0);
  }
}

function eyeBallPath(shape: EyeBallShape, x: number, y: number): string {
  switch (shape) {
    case "circle":
      return circle(x + 3.5, y + 3.5, 1.5);
    case "rounded":
      return rr(x + 2, y + 2, 3, 3, 0.9);
    case "diamond":
      return diamond(x + 3.5, y + 3.5, 1.9);
    case "leaf":
      return rr(x + 2, y + 2, 3, 3, 1.4, 0, 1.4, 0);
    default:
      return rr(x + 2, y + 2, 3, 3, 0);
  }
}

/**
 * Renders a styled QR symbol and runs the scan check against the exact geometry.
 * The check counts the codewords hidden by the logo/center text per error-correction block
 * and compares them with what Reed–Solomon can recover (≤ ecc/2 errors per block),
 * refuses covered finder/timing patterns, and checks color contrast.
 */
/** Error correction for a style: H when a logo or text covers the center (it must be recoverable), M otherwise. */
export function eclForStyle(style: Pick<QrStyle, "logo" | "centerText">): ErrorCorrectionLevel {
  return style.logo || style.centerText?.text ? "H" : "M";
}

export function renderQr(value: string, style: QrStyle): RenderedQr {
  const logo = style.logo ?? null;
  const centerText = style.centerText?.text ? style.centerText : null;
  const m = encodeQr(value, eclForStyle(style));
  const n = m.size;
  const q = QUIET;
  const V = n + 2 * q;
  const c = q + n / 2;
  const { fg, eye, eyeIn, bg } = style.colors;

  const textChars = centerText ? centerText.text.slice(0, 14) : "";
  const textW = centerText ? Math.min(0.5, 0.12 + textChars.length * 0.034) : 0;
  const textH = 0.13;
  const exc: Excavation | null = centerText
    ? { shape: "rect", size: 1, halfW: (textW * n) / 2 + 0.6, halfH: (textH * n) / 2 + 0.6, pad: 0 }
    : logo
      ? {
          shape: logo.tile || logo.plate === "square" || logo.plate === "none" ? "square" : "circle",
          size: Math.max(0.08, Math.min(0.46, logo.size)),
          halfW: 0,
          halfH: 0,
          pad: logo.plate === "none" && !logo.tile ? 0.3 : 0.8,
        }
      : null;

  const inside = (x: number, y: number, e: Excavation | null, size?: number): boolean => {
    if (!e) return false;
    const px = q + x + 0.5;
    const py = q + y + 0.5;
    if (e.shape === "rect") return Math.abs(px - c) <= e.halfW && Math.abs(py - c) <= e.halfH;
    const r = ((size ?? e.size) * n) / 2 + e.pad;
    if (e.shape === "circle") return (px - c) ** 2 + (py - c) ** 2 <= r * r;
    return Math.abs(px - c) <= r && Math.abs(py - c) <= r;
  };
  const critical = (x: number, y: number) => (x < 9 && y < 9) || (x >= n - 8 && y < 9) || (x < 9 && y >= n - 8) || x === 6 || y === 6;
  const recoverable = (size?: number) => {
    const hidden = new Set<number>();
    let hitsCritical = false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!inside(x, y, exc, size)) continue;
        if (critical(x, y)) {
          hitsCritical = true;
          continue;
        }
        const cw = m.codewordAt[y][x];
        if (cw >= 0) hidden.add(cw);
      }
    }
    const perBlock = new Array<number>(m.blockCount).fill(0);
    hidden.forEach((cw) => perBlock[m.codewordBlock[cw]]++);
    return !hitsCritical && Math.max(0, ...perBlock) <= Math.floor(m.eccPerBlock / 2);
  };

  let maxLogoSize = 0;
  if (exc && exc.shape !== "rect") {
    for (let s = 0.46; s >= 0.079; s -= 0.02) {
      if (recoverable(s)) {
        maxLogoSize = Math.floor(s * 100) / 100;
        break;
      }
    }
  }
  const centerOk = exc ? recoverable() : true;

  const issues: ScanIssue[] = [];
  if (luminance(fg) > luminance(bg)) {
    issues.push({
      code: "invert",
      title: "Light code on a dark background",
      detail: "Many phone cameras can't read inverted codes.",
      fix: "Swap colors",
    });
  } else if (contrastRatio(fg, bg) < 3) {
    issues.push({
      code: "contrast",
      title: "Not enough contrast",
      detail: `Code and background are ${contrastRatio(fg, bg).toFixed(1)}:1. Aim for at least 4:1.`,
      fix: "Increase contrast",
    });
  }
  if (contrastRatio(eye, bg) < 3 || contrastRatio(eyeIn, bg) < 2.5) {
    issues.push({
      code: "eyes",
      title: "Corner markers are too light",
      detail: "Scanners find the code by its corner markers.",
      fix: "Darken corner markers",
    });
  }
  if (!centerOk) {
    issues.push(
      centerText
        ? { code: "text", title: "The text in the code is too long", detail: "Keep it to about 8 characters.", fix: "Shorten the text" }
        : {
            code: "logo",
            title: "The logo hides too much of the code",
            detail: `Keep it at ${Math.round(maxLogoSize * 100)}% or smaller.`,
            fix: "Reduce logo size",
          },
    );
  }

  const eyeZone = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  // Only data modules take the module style (HEY-30). Function modules (timing, alignment, format and version
  // information, the dark module), classified by the encoder's mask, are always plain squares; finder patterns are
  // drawn by the eye shapes. The scan check and decoders rely on these fixed patterns.
  const on = (x: number, y: number) => m.modules[y][x] && !m.functionModules[y][x] && !inside(x, y, exc);
  const fixed = (x: number, y: number) => m.modules[y][x] && m.functionModules[y][x] && !eyeZone(x, y) && !inside(x, y, exc);
  const data = moduleShapes(m, style.pattern, on);
  const functionPatterns = moduleShapes(m, "square", fixed);

  let frames = "";
  let balls = "";
  for (const [x, y] of [
    [q, q],
    [q + n - 7, q],
    [q, q + n - 7],
  ] as const) {
    frames += eyeFramePath(style.eyeFrame, x, y);
    balls += eyeBallPath(style.eyeBall, x, y);
  }

  let inner = `<rect width="${V}" height="${V}" fill="${bg}"/>`;
  inner += `<path d="${data}" fill="${fg}"/>`;
  inner += `<path d="${functionPatterns}" fill="${fg}"/>`;
  inner += `<path d="${frames}" fill="${eye}" fill-rule="evenodd"/>`;
  inner += `<path d="${balls}" fill="${eyeIn}"/>`;

  if (centerText) {
    inner += `<path d="${rr(c - (textW * n) / 2, c - (textH * n) / 2, textW * n, textH * n, textH * n * 0.32)}" fill="${centerText.bg}"/>`;
    const fs = Math.min(textH * n * 0.62, (textW * n * 0.86) / (Math.max(1, textChars.length) * 0.6));
    inner += `<text x="${f(c)}" y="${f(c)}" fill="${centerText.color}" font-family="${escapeXml(centerText.fontFamily)}" font-size="${f(fs)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(textChars)}</text>`;
  } else if (logo && exc) {
    const side = exc.size * n;
    const lx = c - side / 2;
    if (logo.tile || logo.plate !== "none") {
      const plateFill = logo.tile ? (logo.plateColor ?? eyeIn) : (logo.plateColor ?? bg);
      const plate =
        exc.shape === "circle" && !logo.tile
          ? circle(c, c, side / 2 + exc.pad * 0.7)
          : rr(
              lx - exc.pad * 0.7,
              lx - exc.pad * 0.7,
              side + exc.pad * 1.4,
              side + exc.pad * 1.4,
              logo.tile ? (side + exc.pad * 1.4) * 0.24 : 0.8,
            );
      inner += `<path d="${plate}" fill="${plateFill}"/>`;
    }
    if (logo.iconPath) {
      const k = logo.tile ? 0.3 : 0.34;
      const color = logo.tile ? bg : (logo.iconColor ?? eyeIn);
      inner += `<g transform="translate(${f(c - side * k)} ${f(c - side * k)}) scale(${f((side * k * 2) / 24)})"><path d="${logo.iconPath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    } else if (logo.href) {
      inner += `<image href="${escapeXml(logo.href)}" x="${f(lx)}" y="${f(lx)}" width="${f(side)}" height="${f(side)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
  }

  const scan: ScanReport = { ok: issues.length === 0, issues, maxLogoSize, version: m.version, ecl: m.ecl, modules: n };
  return { inner, viewBox: V, scan };
}

/** Standalone SVG document for a bare QR symbol. */
export function renderQrSvg(value: string, style: QrStyle, sizePx = 512): string {
  const r = renderQr(value, style);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${r.viewBox} ${r.viewBox}" shape-rendering="geometricPrecision">${r.inner}</svg>`;
}
