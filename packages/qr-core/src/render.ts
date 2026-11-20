import { contrastRatio, luminance, mixColors } from "./color";
import { encodeQr, type ErrorCorrectionLevel, type QrMatrix } from "./encode";
import { lru } from "./memo";
import { circle, diamond, escapeXml, round3 as f, roundedRect as rr } from "./geometry";
import type { EyeBallShape, EyeFrameShape, ModuleShape, QrStyle, RenderedQr, ScanIssue, ScanReport } from "./types";

const QUIET = 4;

/** Recently encoded matrices, by error correction level and value (HEY-62). */
const matrices = lru<QrMatrix>(16);

type Excavation = { shape: "circle" | "square" | "rect"; size: number; halfW: number; halfH: number; pad: number };

function moduleShapes(n: number, pattern: ModuleShape, on: (x: number, y: number) => boolean): string {
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
/** Design STYLES thumbnails (MINI): a 4 × 4 sample of modules, drawn with the renderer's own module shapes. */
export const STYLE_SWATCH = [
  [1, 1, 0, 1],
  [0, 1, 1, 1],
  [1, 1, 0, 0],
  [1, 0, 1, 1],
] as const;

/**
 * The path of a small module grid in one module shape, for style thumbnails. Coordinates are offset by the quiet zone
 * like the code itself: the 4 × 4 swatch spans 4–8; view it with "3.4 3.4 5.2 5.2" (design: -0.6 -0.6 5.2 5.2).
 */
export function moduleSwatch(pattern: ModuleShape, grid: readonly (readonly number[])[] = STYLE_SWATCH): string {
  return moduleShapes(grid.length, pattern, (x, y) => grid[y]?.[x] === 1);
}

export function eclForStyle(style: Pick<QrStyle, "logo" | "centerText">): ErrorCorrectionLevel {
  return style.logo || style.centerText?.text ? "H" : "M";
}

/**
 * Minimum WCAG contrast against the background (the product's existing thresholds): data modules and corner frames
 * 3:1, corner centres 2.5:1 (they sit inside the frame, which scanners find first).
 */
export const MIN_CONTRAST = { modules: 3, eyeFrame: 3, eyeCenter: 2.5 } as const;

/**
 * HEY-52: the centre logo's size limits, as a fraction of the QR symbol's width (its modules, quiet zone excluded).
 * The size is the logo box: the image sits centred in it at its own aspect ratio (inscribed in the circle on a circular
 * backing). The area cleared of modules is that box plus 0.8 module on each side with a backing (0.5 without), and the
 * scan check counts that whole cleared area. Design handoff: Logo size 10–46 %.
 */
export const CENTER_LOGO_SIZE = { min: 0.1, max: 0.46 } as const;

/** The size a centre logo is drawn at: any saved value, kept within CENTER_LOGO_SIZE (older layouts are not rewritten). */
export function centerLogoSize(size: number): number {
  return Math.max(CENTER_LOGO_SIZE.min, Math.min(CENTER_LOGO_SIZE.max, Number.isFinite(size) ? size : CENTER_LOGO_SIZE.min));
}

/** Design 2.7 Artwork shapes in a 100 × 100 box scaled to the symbol (prototype ART_PARTS); `t` = tint, `a` = accent. */
const ART_PARTS = [
  { d: "M-6 104C4 72 22 54 52 46C40 70 20 92-6 104z", k: "t", op: 0.42 },
  { d: "M106-4C96 26 78 42 50 50C60 26 80 6 106-4z", k: "t", op: 0.42 },
  { d: "M104 70c-14 4-26 14-32 34c16-2 28-14 32-34z", k: "a", op: 0.2 },
  { d: "M-4 28c12-2 24 4 30 16c-14 2-26-4-30-16z", k: "a", op: 0.2 },
] as const;
/** The strongest tint over the background: colour rules check the code against this, not the plain background. */
export const ART_TINT_OPACITY = 0.42;

/** Design QR.dc build(): a caption inside the code holds at most 14 characters, so its letters stay legible. */
export const CENTER_TEXT_MAX = 14;

/**
 * The text a caption shows inside the code: its first line, whole when it fits CENTER_TEXT_MAX characters, else cut at
 * the last whole word that fits and marked with an ellipsis (a single long word is cut at the limit). Never a silent
 * mid-word cut ("Little Fern Coffee" → "Little Fern…").
 */
export function centerTextLabel(text: string): { label: string; shortened: boolean } {
  const line = (text.split("\n")[0] ?? "").trim();
  if ([...line].length <= CENTER_TEXT_MAX) return { label: line, shortened: false };
  const room = [...line].slice(0, CENTER_TEXT_MAX - 1).join("");
  const cut = room.lastIndexOf(" ");
  return { label: `${(cut > 0 ? room.slice(0, cut) : room).trimEnd()}…`, shortened: true };
}

export function renderQr(value: string, style: QrStyle): RenderedQr {
  const logo = style.logo ?? null;
  const centerText = style.centerText?.text ? style.centerText : null;
  // The matrix depends only on the value and error correction level: reused while other settings change (HEY-62).
  const ecl = eclForStyle(style);
  const m = matrices(`${ecl}\u0000${value}`, () => encodeQr(value, ecl));
  const n = m.size;
  const q = QUIET;
  const V = n + 2 * q;
  const c = q + n / 2;
  const { fg, eye, eyeIn, bg } = style.colors;

  const textChars = centerText ? centerTextLabel(centerText.text).label : "";
  const textW = centerText ? Math.min(0.5, 0.12 + textChars.length * 0.034) : 0;
  const textH = 0.13;
  const exc: Excavation | null = centerText
    ? { shape: "rect", size: 1, halfW: (textW * n) / 2 + 0.6, halfH: (textH * n) / 2 + 0.6, pad: 0 }
    : logo
      ? {
          shape: logo.tile || logo.plate === "square" || logo.plate === "none" ? "square" : "circle",
          size: centerLogoSize(logo.size),
          halfW: 0,
          halfH: 0,
          // Cleared margin around the logo box, in modules. A module is cleared when its centre is inside; 0.5 or more
          // means no drawn module reaches into the box (HEY-52: with 0.3, modules overlapped an unbacked logo by 0.2).
          pad: logo.plate === "none" && !logo.tile ? 0.5 : 0.8,
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
    // Whole percentages, largest first: the biggest logo (with its cleared area) the code can still recover from.
    for (let pct = Math.round(CENTER_LOGO_SIZE.max * 100); pct >= Math.round(CENTER_LOGO_SIZE.min * 100); pct--) {
      if (recoverable(pct / 100)) {
        maxLogoSize = pct / 100;
        break;
      }
    }
  }
  const centerOk = exc ? recoverable() : true;

  const art = style.art ?? null;
  // Artwork tints parts of the background: the colour rules use the most tinted background the modules may sit on.
  const checkBg = art ? mixColors(bg, art.tint, ART_TINT_OPACITY) : bg;
  const issues: ScanIssue[] = [];
  // Colour rules (HEY-38). Effective colours after inheritance; WCAG relative-luminance contrast. Both the data modules
  // and the finder parts must be darker than the background (scanners look for dark-on-light finder patterns; a light
  // finder on a mid-tone background can pass a ratio check yet not decode) and reach the minimum contrast.
  // This is a rule-based check, not a decode: tests confirm passing palettes with ZXing separately.
  if (luminance(fg) > luminance(checkBg)) {
    issues.push({
      code: "invert",
      title: "Light code on a dark background",
      detail: "Many phone cameras can't read inverted codes.",
      fix: "Swap colors",
    });
  } else if (contrastRatio(fg, checkBg) < MIN_CONTRAST.modules) {
    issues.push({
      code: "contrast",
      title: "Not enough contrast",
      detail: `Code and background are ${contrastRatio(fg, checkBg).toFixed(1)}:1. It needs at least ${MIN_CONTRAST.modules}:1.`,
      fix: "Increase contrast",
    });
  }
  const finderTooLight =
    luminance(eye) > luminance(checkBg) ||
    luminance(eyeIn) > luminance(checkBg) ||
    contrastRatio(eye, checkBg) < MIN_CONTRAST.eyeFrame ||
    contrastRatio(eyeIn, checkBg) < MIN_CONTRAST.eyeCenter;
  if (finderTooLight) {
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
  const data = moduleShapes(m.size, style.pattern, on);
  const functionPatterns = moduleShapes(m.size, "square", fixed);

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
  if (art) {
    inner += `<g transform="scale(${f(V / 100)})">${ART_PARTS.map((p) => `<path d="${p.d}" fill="${p.k === "t" ? art.tint : art.tint2}" fill-opacity="${p.op}"/>`).join("")}</g>`;
    if (art.image)
      inner += `<image href="${escapeXml(art.image)}" x="0" y="0" width="${V}" height="${V}" opacity="0.13" preserveAspectRatio="xMidYMid slice"/>`;
  }
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
      // HEY-51: the image is centred in its box and keeps its aspect ratio. On a circular backing the box is the square
      // inscribed in the circle (side / √2), so no corner of the image reaches past the plate onto the modules.
      const box = exc.shape === "circle" && !logo.tile ? side / Math.SQRT2 : side;
      const bx = c - box / 2;
      inner += `<image href="${escapeXml(logo.href)}" x="${f(bx)}" y="${f(bx)}" width="${f(box)}" height="${f(box)}" preserveAspectRatio="xMidYMid meet"/>`;
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
