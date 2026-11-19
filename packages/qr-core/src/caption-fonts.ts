/*
 * HEY-44: caption fonts. The one mapping from a saved font ID to the font faces the browser preview, the PNG rasterizer
 * and exported SVGs use. Files live in the app's public/caption-fonts (sources, licences and changes in its README).
 *
 * IDs are the design's caption font slots. Where the design's font has no Cyrillic, the slot ships a licensed
 * substitute with Cyrillic: dm → Onest, fraunces → Literata, grotesk → Golos Text, instrument → Prata.
 */
export const CAPTION_FONT_IDS = ["dm", "fraunces", "grotesk", "instrument", "caveat", "mono"] as const;
export type CaptionFontId = (typeof CAPTION_FONT_IDS)[number];
export type CaptionWeight = 400 | 500 | 700;
export const CAPTION_WEIGHTS: readonly CaptionWeight[] = [400, 500, 700];

export interface CaptionFont {
  /** Name shown in the font picker (the family actually shipped). */
  label: string;
  /** The design's font this slot stands for. */
  designFont: string;
  /** Family name of the shipped faces (as declared in @font-face and inside the font files). */
  family: string;
  /** Generic fallback after the family in CSS / SVG. */
  generic: "sans-serif" | "serif" | "cursive" | "monospace";
  /** File (in public/caption-fonts) for each supported weight. */
  faces: Partial<Record<CaptionWeight, string>>;
  /**
   * Average advance per character in em, used to fit the caption to its box: the widest of Latin and Cyrillic
   * sample text at the boldest shipped weight, measured from the files, rounded up.
   */
  charWidth: number;
}

export const CAPTION_FONTS: Record<CaptionFontId, CaptionFont> = {
  dm: {
    label: "Onest",
    designFont: "DM Sans",
    family: "HeyQR Onest",
    generic: "sans-serif",
    charWidth: 0.56,
    faces: { 400: "HeyQROnest-Regular.ttf", 500: "HeyQROnest-Medium.ttf", 700: "HeyQROnest-Bold.ttf" },
  },
  fraunces: {
    label: "Literata",
    designFont: "Fraunces",
    family: "HeyQR Literata",
    generic: "serif",
    charWidth: 0.59,
    faces: { 400: "HeyQRLiterata-Regular.ttf", 500: "HeyQRLiterata-Medium.ttf", 700: "HeyQRLiterata-Bold.ttf" },
  },
  grotesk: {
    label: "Golos Text",
    designFont: "Space Grotesk",
    family: "HeyQR Golos Text",
    generic: "sans-serif",
    charWidth: 0.56,
    faces: { 400: "HeyQRGolosText-Regular.ttf", 500: "HeyQRGolosText-Medium.ttf", 700: "HeyQRGolosText-Bold.ttf" },
  },
  instrument: {
    label: "Prata",
    designFont: "Instrument Serif",
    family: "Prata",
    generic: "serif",
    charWidth: 0.56,
    faces: { 400: "Prata-Regular.ttf" },
  },
  caveat: {
    label: "Caveat",
    designFont: "Caveat",
    family: "HeyQR Caveat",
    generic: "cursive",
    charWidth: 0.4,
    faces: { 400: "HeyQRCaveat-Regular.ttf", 500: "HeyQRCaveat-Medium.ttf", 700: "HeyQRCaveat-Bold.ttf" },
  },
  mono: {
    label: "IBM Plex Mono",
    designFont: "IBM Plex Mono",
    family: "IBM Plex Mono",
    generic: "monospace",
    charWidth: 0.61,
    faces: { 400: "IBMPlexMono-Regular.ttf", 500: "IBMPlexMono-Medium.ttf", 700: "IBMPlexMono-Bold.ttf" },
  },
};

export const DEFAULT_CAPTION_FONT: CaptionFontId = "dm";
export const DEFAULT_CAPTION_WEIGHT: CaptionWeight = 700;

/** Layouts saved before HEY-44 have no font ID: they keep DM Sans (Latin only), exactly as they were exported. */
export const LEGACY_CAPTION_FONT: CaptionFont = {
  label: "DM Sans",
  designFont: "DM Sans",
  family: "DM Sans",
  generic: "sans-serif",
  faces: { 400: "DMSans-Regular.ttf", 700: "DMSans-Bold.ttf" },
  charWidth: 0.56,
};

export function isCaptionFontId(v: unknown): v is CaptionFontId {
  return typeof v === "string" && (CAPTION_FONT_IDS as readonly string[]).includes(v);
}

export function supportedWeights(id: CaptionFontId): CaptionWeight[] {
  return CAPTION_WEIGHTS.filter((w) => CAPTION_FONTS[id].faces[w]);
}

/** The closest weight the font ships (a stored weight the font lacks never falls back to synthetic bold). */
export function captionWeightFor(id: CaptionFontId, weight: number): CaptionWeight {
  const ws = supportedWeights(id);
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0] ?? 400);
}

/** CSS / SVG font-family list for a caption font. */
export function captionFontFamily(font: CaptionFont): string {
  return `'${font.family}', ${font.generic}`;
}

/** Caption fonts a layout draws with: its font (or the legacy one) and the weights of its lines (first line, others 400). */
export function captionFaces(caption: { font?: CaptionFontId; weight: number; text: string }): {
  font: CaptionFont;
  weights: CaptionWeight[];
} {
  const font = caption.font ? CAPTION_FONTS[caption.font] : LEGACY_CAPTION_FONT;
  const first = (caption.font ? captionWeightFor(caption.font, caption.weight) : caption.weight >= 600 ? 700 : 400) as CaptionWeight;
  const weights = caption.text.includes("\n") ? [...new Set<CaptionWeight>([first, 400])] : [first];
  return { font, weights: weights.filter((w) => font.faces[w]) };
}
