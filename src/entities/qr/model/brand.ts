import { ART_TINT_OPACITY, contrastRatio, luminance, MIN_CONTRAST, mixColors } from "@heyqr/qr-core";
import type { EditorDesign, EditorPreset } from "./design";

/*
 * Design 2.4–2.9 "Branded design": colours read from the user's logo or image, three roles (code colour, background,
 * accent) and three looks of the same code. Everything here is pure, so the browser (canvas pixels) and tests share it.
 */

export type BrandLook = "center" | "card" | "art";
export const BRAND_LOOKS: readonly BrandLook[] = ["center", "card", "art"];
export type BrandRole = "primary" | "bg" | "accent";
export type BrandColors = Record<BrandRole, string>;

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const saturation = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};
const distance = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

/**
 * The image's main colours, most used first. `pixels` is RGBA (canvas ImageData). Opaque pixels are counted in
 * 5-bit-per-channel buckets and each bucket keeps its own average, so the flat colours of a logo come back exact;
 * near-duplicates are merged and at most `max` colours are returned.
 */
export function extractPalette(pixels: Uint8ClampedArray | Uint8Array, max = 6): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 160) continue;
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  const opaque = [...buckets.values()].reduce((n, c) => n + c.n, 0);
  // Anti-aliased edges make many tiny buckets between two flat colours; they are not colours of the image.
  const colours = [...buckets.values()]
    .filter((c) => c.n >= opaque * 0.015)
    .sort((a, b) => b.n - a.n)
    .map((c) => ({ hex: hex(c.r / c.n, c.g / c.n, c.b / c.n), n: c.n }));
  const out: string[] = [];
  for (const c of colours) {
    if (out.length >= max) break;
    if (!out.some((o) => distance(o, c.hex) < 28)) out.push(c.hex);
  }
  return out;
}

/**
 * The three roles from a palette, scannable by construction: the background is the lightest colour (white when the image
 * has no light one), the code colour the most-used colour dark enough against it (ink when none is), the accent the most
 * saturated remaining colour that is also dark enough for the corner centres.
 */
export function brandRoles(palette: readonly string[]): BrandColors {
  const light = [...palette].sort((a, b) => luminance(b) - luminance(a))[0];
  const bg = light && luminance(light) >= 0.72 ? light : "#FFFFFF";
  const usable = palette.filter((c) => c !== bg && luminance(c) < luminance(bg) && contrastRatio(c, bg) >= MIN_CONTRAST.modules + 0.5);
  const primary = usable[0] ?? "#0D0D12";
  // The accent colours the corner centres, so it needs their (lower) contrast, not the modules'.
  const accent =
    palette
      .filter((c) => c !== bg && c !== primary && luminance(c) < luminance(bg) && contrastRatio(c, bg) >= MIN_CONTRAST.eyeCenter + 0.3)
      .sort((a, b) => saturation(b) - saturation(a))[0] ?? primary;
  return { primary, bg, accent };
}

/** The roles as design settings: code and corner frames in the code colour, corner centres in the accent. */
export function brandColorPatch(c: BrandColors): Partial<EditorDesign> {
  return { fg: c.primary, eye: c.primary, eyeIn: c.accent, bg: c.bg, frameColor: c.primary, captionColor: c.primary };
}

/** The roles a design currently shows (after edits). */
export function brandColorsOf(d: EditorDesign): BrandColors {
  return { primary: d.fg, bg: d.bg, accent: d.eyeIn ?? d.fg };
}

/** A readable brand name from an image file name: "little-fern_coffee.svg" → "Little Fern Coffee". */
export function brandNameFromFile(file: string): string {
  const base = file
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return base.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()).slice(0, 40);
}

/**
 * One look as one patch (one Undo step), keeping the content, the image and the chosen colours:
 *   center  the image in the code on a circle plate (layout kept, cards return to QR + caption)
 *   card    Vertical card with the image and brand name above the code
 *   art     the image flows into tinted shapes behind dotted modules and round corners
 */
export function brandLookPatch(d: EditorDesign, look: BrandLook): Partial<EditorDesign> {
  const colors = brandColorsOf(d);
  // The tint sits under the modules: of the image's other colours, the lightest that keeps the code and its corners
  // within the scan check's colour rules on the tinted background; otherwise a light mix of the code colour.
  const keeps = (c: string) => {
    const under = mixColors(colors.bg, c, ART_TINT_OPACITY);
    return (
      // The scan check's own colour rules (render.ts), against the tinted background.
      contrastRatio(colors.primary, under) >= MIN_CONTRAST.modules &&
      contrastRatio(colors.accent, under) >= MIN_CONTRAST.eyeCenter &&
      luminance(colors.accent) < luminance(under)
    );
  };
  const tint =
    (d.brand?.palette ?? [])
      .filter((c) => ![colors.primary, colors.bg, colors.accent].includes(c))
      .sort((a, b) => luminance(b) - luminance(a))
      .find(keeps) ?? mixColors(colors.bg, colors.primary, 0.2);
  const offCard: EditorPreset = d.preset === "vertical" || d.preset === "horizontal" ? (d.caption.trim() ? "caption" : "qr") : d.preset;
  switch (look) {
    case "center":
      return { look, preset: offCard, logoPosition: "center", logoPlate: "circle", logoSize: 0.26, art: undefined };
    case "card":
      return {
        look,
        preset: "vertical",
        logoPosition: "top",
        brandName: d.brandName ?? (d.brand?.name ? brandNameFromFile(d.brand.name) : undefined),
        art: undefined,
      };
    case "art":
      return {
        look,
        preset: offCard,
        logoPosition: "center",
        logoPlate: "none",
        logoSize: 0.3,
        pattern: "dot",
        eyeFrame: "circle",
        eyeBall: "circle",
        art: { tint, tint2: colors.accent },
      };
  }
}

/** Design 2.5 sample logo (Little Fern Coffee), so the branded flow can be tried without a file. */
export const SAMPLE_LOGO = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M2 50a48 48 0 1 0 96 0a48 48 0 1 0-96 0z" fill="#1F4D3A"/><path d="M27 47h42v9c0 13-9.4 22-21 22s-21-9-21-22z" fill="#F7F1E6"/><path d="M69 50h4.5a8 8 0 0 1 0 16H68v-5h5.5a3 3 0 0 0 0-6H69z" fill="#F7F1E6"/><path d="M20 81h56a3.5 3.5 0 0 1 0 7H20a3.5 3.5 0 0 1 0-7z" fill="#F7F1E6"/><path d="M48 43c-7-6-8-16-1-27c8 10 8 20 1 27z" fill="#C8643B"/><path d="M47 31c-6 1-11-2-13-7c6-1 11 2 13 7z" fill="#8DB596"/></svg>',
)}`;
