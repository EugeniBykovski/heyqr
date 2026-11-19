/*
 * Design 1.8 "Size": the code size (including the quiet zone) and, for layouts that have their own canvas, the layout
 * width × height. Screen sizes are in px, where 1 unit = 1 pixel at 1× (PNG export renders at 2× by default).
 * One rule (parseSizeValue) decides what a field accepts and what a saved draft may hold.
 */

export type SizeUnit = "px";
export type SizeField = "qr" | "width" | "height";

export interface DesignSize {
  unit: SizeUnit;
  /** Code size including the quiet zone. */
  qr: number;
  /** Layout canvas, used by layouts with their own canvas ("caption"); "qr" and "frame" derive it from the code. */
  width: number;
  height: number;
}

/** Limits per unit (design: QR 120–2400 px in steps of 10). Layout limits cover the design's screen presets. */
export const SIZE_LIMITS: Record<SizeUnit, { qr: readonly [number, number]; layout: readonly [number, number]; step: number }> = {
  px: { qr: [120, 2400], layout: [120, 4000], step: 10 },
};

/** What a draft without a size (every draft before HEY-35) renders at: a 512 px code, a 512 × 625 caption layout. */
export const LEGACY_SIZE: DesignSize = { unit: "px", qr: 512, width: 512, height: 625 };

/** Screen presets from the handoff, for layouts with their own canvas. */
export const PX_PRESETS = [
  { key: "square", width: 1080, height: 1080 },
  { key: "story", width: 1080, height: 1920 },
  { key: "slide", width: 1920, height: 1080 },
] as const;

export function sizeLimits(unit: SizeUnit, field: SizeField): readonly [number, number] {
  return field === "qr" ? SIZE_LIMITS[unit].qr : SIZE_LIMITS[unit].layout;
}

/** A typed or stored value as a size the renderer may use: a whole number of px within the limits, or null. */
export function parseSizeValue(input: string | number, unit: SizeUnit, field: SizeField): number | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  const [min, max] = sizeLimits(unit, field);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** Whether a whole size is usable (every part passes parseSizeValue). */
export function isValidSize(size: DesignSize): boolean {
  return (["qr", "width", "height"] as const).every((f) => parseSizeValue(size[f], size.unit, f) === size[f]);
}

/** A screen preset applied to a layout canvas: the code takes 72 % of the short side (handoff), rounded to the step. */
export function presetSize(width: number, height: number): DesignSize {
  const qr = Math.round((Math.min(width, height) * 0.72) / 10) * 10;
  return { unit: "px", qr, width, height };
}
