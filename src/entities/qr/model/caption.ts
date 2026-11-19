/*
 * HEY-43: the caption length rule, shared by every field that accepts new caption text.
 *
 * Design handoff "Design → Caption": a two-row text field, up to 80 characters, Enter for a second line, empty hides
 * the caption. Characters are counted as people see them (Unicode grapheme clusters): an emoji with skin tone or ZWJ,
 * a letter with combining marks, or a flag counts as one; a line break counts as one. At most two lines.
 * Saved designs keep their own, looser ceiling (design-schema), so captions saved before this rule still load.
 */
export const CAPTION_MAX_CHARS = 80;
export const CAPTION_MAX_LINES = 2;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Line breaks as typed or pasted (CRLF, CR) become "\n", the only break the renderer knows. */
export function normalizeCaption(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Characters as people see them, line breaks included. */
export function captionLength(text: string): number {
  return Array.from(graphemes.segment(normalizeCaption(text))).length;
}

export type CaptionCheck = { ok: true; length: number } | { ok: false; length: number; reason: "tooLong" | "tooManyLines" };

export function checkCaption(text: string): CaptionCheck {
  const normalized = normalizeCaption(text);
  const length = captionLength(normalized);
  if (length > CAPTION_MAX_CHARS) return { ok: false, length, reason: "tooLong" };
  if (normalized.split("\n").length > CAPTION_MAX_LINES) return { ok: false, length, reason: "tooManyLines" };
  return { ok: true, length };
}

/*
 * HEY-45: caption type size. The design's Size field: px for screen layouts, pt for print layouts, 4–400 px or
 * 4–120 pt, one decimal at most. Unset (every layout before HEY-45) is the size the renderer always used: a share of
 * the code (40 px at a 512 px code), so older layouts keep their look. The renderer may still shrink a caption that
 * doesn't fit its band; the preview, SVG and PNG all use that same calculation (qr-core captionFontSize).
 */
export type CaptionSizeUnit = "px" | "pt";
export const CAPTION_SIZE_LIMITS: Record<CaptionSizeUnit, readonly [number, number]> = { px: [4, 400], pt: [4, 120] };
/** 1 pt in mm (the renderer converts print caption sizes with the same factor). */
export const MM_PER_PT = 0.3528;
/** Caption type size at the legacy 512 px code. */
const CAPTION_PX_AT_LEGACY = 40;
const LEGACY_QR_PX = 512;

export const captionSizeUnit = (layoutUnit: "px" | "mm"): CaptionSizeUnit => (layoutUnit === "px" ? "px" : "pt");

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The size used when none was chosen, in the layout's caption unit (unrounded, exactly as before HEY-45). */
export function defaultCaptionSize(size: { unit: "px" | "mm"; qr: number }): number {
  return ((CAPTION_PX_AT_LEGACY * size.qr) / LEGACY_QR_PX) * (size.unit === "mm" ? 1 / MM_PER_PT : 1);
}

/** A typed size in the given unit, or null when it isn't a number within the limits with at most one decimal. */
export function parseCaptionSize(text: string, unit: CaptionSizeUnit): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d)?$/.test(t)) return null;
  const v = Number(t);
  const [min, max] = CAPTION_SIZE_LIMITS[unit];
  return v >= min && v <= max ? v : null;
}

/** Converts a chosen size when the layout switches between px and mm, keeping the same share of the code. */
export function convertCaptionSize(value: number, from: { unit: "px" | "mm"; qr: number }, to: { unit: "px" | "mm"; qr: number }): number {
  const share = (from.unit === "px" ? value : value * MM_PER_PT) / from.qr;
  const next = to.unit === "px" ? share * to.qr : (share * to.qr) / MM_PER_PT;
  const [min, max] = CAPTION_SIZE_LIMITS[captionSizeUnit(to.unit)];
  return Math.min(max, Math.max(min, round1(next)));
}
