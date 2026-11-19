/*
 * HEY-47: caption line breaking, in layout units. Every output (browser preview, SVG, PNG) gets the same line breaks
 * because they are computed here from the caption font's own advance widths (caption-metrics.ts, generated from the
 * shipped files), never from what a browser or rasterizer happens to measure, and never from viewport or PNG pixels.
 *
 * Rules:
 * - Explicit line breaks (Enter) are kept. The first line is the title line (chosen size and weight); later lines are
 *   the secondary style (0.74 of the size, Regular, 72 % opacity), and their wrapped continuations keep that style.
 * - Lines wrap at spaces. A single word wider than the line is split between grapheme clusters only, so letters with
 *   combining marks and joined emoji are never cut.
 * - The caption is drawn at the largest size up to the chosen one at which the wrapped lines fit the caption band
 *   (the same width and height margins as before: 94 % of the width, 86 % of the height). A caption that already fit on
 *   its lines keeps exactly the size and position it had.
 */
import { CAPTION_FONTS, captionWeightFor, LEGACY_CAPTION_FONT, type CaptionFontId } from "./caption-fonts";
import { CAPTION_METRICS } from "./caption-metrics";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const faces = new Map<string, { widths: Map<number, number>; fallback: number }>();

function face(file: string) {
  let f = faces.get(file);
  if (!f) {
    const m = CAPTION_METRICS[file];
    const widths = new Map<number, number>();
    for (const [first, ws] of m?.runs ?? []) ws.forEach((w, i) => widths.set(first + i, w));
    f = { widths, fallback: m?.fallback ?? 600 };
    faces.set(file, f);
  }
  return f;
}

/** The face file a caption line is drawn with: its font at the nearest shipped weight, or the original DM Sans. */
export function captionFaceFile(font: CaptionFontId | undefined, weight: number): string {
  if (!font) return (weight >= 600 ? LEGACY_CAPTION_FONT.faces[700] : LEGACY_CAPTION_FONT.faces[400]) ?? "";
  return CAPTION_FONTS[font].faces[captionWeightFor(font, weight)] ?? "";
}

/** Width of `text` at `size` (layout units) in a face. A grapheme the face can't draw counts as one wide letter. */
export function measureCaptionText(text: string, file: string, size: number): number {
  const { widths, fallback } = face(file);
  let units = 0;
  for (const { segment } of graphemes.segment(text)) {
    let sum = 0;
    let known = true;
    for (const ch of segment) {
      const w = widths.get(ch.codePointAt(0) ?? 0);
      if (w === undefined) {
        known = false;
        break;
      }
      sum += w;
    }
    units += known ? sum : fallback;
  }
  return (units / 1000) * size;
}

/** Breaks one explicit line into lines no wider than `maxWidth`: at spaces, or between graphemes for a long word. */
export function wrapCaptionLine(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.split(/[ \t]+/).filter((w) => w !== "");
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    // An unbroken token wider than the line: split it between grapheme clusters, at least one per line.
    line = "";
    for (const { segment } of graphemes.segment(word)) {
      if (line && measure(line + segment) > maxWidth) {
        lines.push(line);
        line = segment;
      } else line += segment;
    }
  }
  lines.push(line);
  return lines;
}

export interface CaptionLine {
  text: string;
  size: number;
  weight: number;
  /** Lines after the first explicit line use the secondary style. */
  secondary: boolean;
}

/** Wrapped caption lines at title size `fs`, and the height they need in the renderer's line-height units. */
export function wrapCaption(
  caption: { text: string; font?: CaptionFontId; weight: number },
  fs: number,
  maxWidth: number,
): { lines: CaptionLine[]; height: number; widest: number } {
  const titleFile = captionFaceFile(caption.font, caption.weight);
  const secondaryFile = captionFaceFile(caption.font, 400);
  const firstWeight = caption.font ? captionWeightFor(caption.font, caption.weight) : caption.weight;
  const lines: CaptionLine[] = [];
  let widest = 0;
  caption.text.split("\n").forEach((paragraph, i) => {
    const secondary = i > 0;
    const size = secondary ? fs * 0.74 : fs;
    const file = secondary ? secondaryFile : titleFile;
    const measure = (s: string) => measureCaptionText(s, file, size);
    for (const text of wrapCaptionLine(paragraph, maxWidth, measure)) {
      widest = Math.max(widest, measure(text));
      lines.push({ text, size, weight: secondary ? 400 : firstWeight, secondary });
    }
  });
  // 1.18 × (title lines × fs + secondary lines × 0.74 fs): the same budget the renderer always used for its lines.
  const height = 1.18 * lines.reduce((sum, l) => sum + l.size, 0);
  return { lines, height, widest };
}

/**
 * The size and lines a caption is drawn with in a band of `width` × `height` layout units: the largest title size up to
 * `base` whose wrapped lines fit 94 % of the width and 86 % of the height.
 */
export function fitCaption(
  caption: { text: string; font?: CaptionFontId; weight: number },
  base: number,
  width: number,
  height: number,
): { fs: number; lines: CaptionLine[] } {
  const maxWidth = width * 0.94;
  const maxHeight = height * 0.86;
  const fits = (fs: number) => {
    const w = wrapCaption(caption, fs, maxWidth);
    return w.height <= maxHeight && w.widest <= maxWidth + 1e-9 ? w : null;
  };
  const atBase = fits(base);
  if (atBase) return { fs: base, lines: atBase.lines };
  let lo = 0;
  let hi = base;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const fs = Math.max(lo, 1e-3);
  return { fs, lines: wrapCaption(caption, fs, maxWidth).lines };
}
