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
