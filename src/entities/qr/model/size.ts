/*
 * Design 1.8 "Size": the code size (including the quiet zone) and, for layouts that have their own canvas, the layout
 * width × height. Screen sizes are in px, where 1 unit = 1 pixel at 1× (PNG export renders at 2× by default); print
 * sizes are in mm (HEY-36), written as physical width/height on the exported SVG (PNG renders at 300 dpi).
 * One rule (parseSizeValue) decides what a field accepts and what a saved draft may hold.
 */

export type SizeUnit = "px" | "mm";
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
  // Print: the design's 10–200 mm for the code; layouts up to A3's long side (≈ 420 mm) with room to spare.
  mm: { qr: [10, 200], layout: [10, 500], step: 1 },
};

/** Design PX = 300 / 25.4: how many px a mm is when switching units (print files are made at 300 dpi). */
export const PX_PER_MM = 300 / 25.4;

/** What a draft without a size (every draft before HEY-35) renders at: a 512 px code, a 512 × 625 caption layout. */
export const LEGACY_SIZE: DesignSize = { unit: "px", qr: 512, width: 512, height: 625 };

/** Print presets from the handoff (mm), for layouts with their own canvas. */
export const MM_PRESETS = [
  { key: "card", width: 90, height: 50 },
  { key: "a6", width: 105, height: 148 },
  { key: "sticker", width: 50, height: 62 },
] as const;

/** Screen presets from the handoff, for layouts with their own canvas. */
export const PX_PRESETS = [
  { key: "square", width: 1080, height: 1080 },
  { key: "story", width: 1080, height: 1920 },
  { key: "slide", width: 1920, height: 1080 },
] as const;

export function sizeLimits(unit: SizeUnit, field: SizeField): readonly [number, number] {
  return field === "qr" ? SIZE_LIMITS[unit].qr : SIZE_LIMITS[unit].layout;
}

/**
 * A typed or stored value as a size the renderer may use, or null: px are whole numbers; mm allow one decimal
 * ("25.5"); both within the unit's limits.
 */
export function parseSizeValue(input: string | number, unit: SizeUnit, field: SizeField): number | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!(unit === "px" ? /^\d+$/ : /^\d+(\.\d)?$/).test(text)) return null;
  const value = Number(text);
  const [min, max] = sizeLimits(unit, field);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** Whether a whole size is usable (every part passes parseSizeValue). */
export function isValidSize(size: DesignSize): boolean {
  return (["qr", "width", "height"] as const).every((f) => parseSizeValue(size[f], size.unit, f) === size[f]);
}

/** A preset applied to a layout canvas: the code takes 72 % of the short side (handoff), rounded to the unit's step. */
export function presetSize(width: number, height: number, unit: SizeUnit = "px"): DesignSize {
  const step = SIZE_LIMITS[unit].step;
  const qr = Math.round((Math.min(width, height) * 0.72) / step) * step;
  return { unit, qr, width, height };
}

/** Switching units keeps the physical proportions (design: × or ÷ 300/25.4), rounded and clamped to the new limits. */
export function convertSize(size: DesignSize, unit: SizeUnit): DesignSize {
  if (size.unit === unit) return size;
  const k = unit === "px" ? PX_PER_MM : 1 / PX_PER_MM;
  const to = (v: number, field: SizeField) => {
    const [min, max] = sizeLimits(unit, field);
    const raw = v * k;
    const rounded = unit === "px" ? Math.round(raw) : Math.round(raw * 10) / 10;
    return Math.min(max, Math.max(min, rounded));
  };
  return { unit, qr: to(size.qr, "qr"), width: to(size.width, "width"), height: to(size.height, "height") };
}
