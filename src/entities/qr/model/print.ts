import { layoutGeometry, type Layout } from "@heyqr/qr-core";

/*
 * Design 8.x Print Preview: the print settings and the sizes they give, shared by the preview screen and the server that
 * renders the print files (Handoff · Commerce §4). Sizes are in mm; the finished size is the layout's size × scale.
 */
export const PRINT_SCALES = [1, 1.5, 2] as const;
export const PRINT_BLEEDS = [0, 2, 3, 5] as const;
export type PrintBleed = (typeof PRINT_BLEEDS)[number];
/** Colour profiles of the design. Only sRGB is available: CMYK needs ICC conversion, which this deployment doesn't have. */
export const PRINT_PROFILES = ["srgb", "fogra39", "gracol", "fogra29"] as const;
export type PrintProfile = (typeof PRINT_PROFILES)[number];
export const AVAILABLE_PROFILES: readonly PrintProfile[] = ["srgb"];
export const CUSTOM_WIDTH = { min: 15, max: 600 } as const;
/** Below this the code can fail on older phones (design 8.x warning). */
export const MIN_PRINT_QR_MM = 20;
/** Raster logos under this effective resolution get the design's logo warning. */
export const MIN_LOGO_PPI = 300;
/** Crop marks: length and their gap from the bleed edge, in mm. */
export const CROP_MARK = { length: 5, gap: 1 } as const;

export interface PrintSettings {
  scale: number;
  bleed: PrintBleed;
  cropMarks: boolean;
  profile: PrintProfile;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { scale: 1, bleed: 3, cropMarks: true, profile: "srgb" };

/** Settings as received from a URL or a request: anything unknown falls back to the default. */
export function readPrintSettings(raw: Record<string, unknown>, layout: Layout): PrintSettings {
  const base = layoutGeometry(layout).width;
  const scale = Number(raw.scale);
  const width = Number(raw.width);
  const bleed = Number(raw.bleed);
  const profile = String(raw.profile ?? "srgb");
  const custom =
    Number.isFinite(width) && width >= CUSTOM_WIDTH.min && width <= CUSTOM_WIDTH.max ? Math.round((width / base) * 1000) / 1000 : null;
  return {
    scale: custom ?? (Number.isFinite(scale) && scale > 0 && scale <= 12 ? scale : 1),
    bleed: (PRINT_BLEEDS as readonly number[]).includes(bleed) ? (bleed as PrintBleed) : DEFAULT_PRINT_SETTINGS.bleed,
    cropMarks: raw.cropMarks === undefined ? true : raw.cropMarks === true || raw.cropMarks === "1" || raw.cropMarks === "true",
    profile: (AVAILABLE_PROFILES as readonly string[]).includes(profile) ? (profile as PrintProfile) : "srgb",
  };
}

/**
 * HEY-196: a colour profile a request names that this deployment can't produce, or null. CMYK needs an ICC conversion
 * and a profile licensed for bundling, neither of which is available, so the server refuses such a request instead of
 * quietly handing back an sRGB file under a CMYK name (readPrintSettings alone would fall back to sRGB).
 */
export function unsupportedProfile(raw: Record<string, unknown>): string | null {
  if (raw.profile === undefined || raw.profile === null || raw.profile === "") return null;
  const p = String(raw.profile);
  return (AVAILABLE_PROFILES as readonly string[]).includes(p) ? null : p;
}

export const printSettingsQuery = (s: PrintSettings) =>
  new URLSearchParams({
    scale: String(s.scale),
    bleed: String(s.bleed),
    cropMarks: s.cropMarks ? "1" : "0",
    profile: s.profile,
  }).toString();

const r1 = (v: number) => Math.round(v * 10) / 10;

export interface PrintSizes {
  /** Finished (trim) size. */
  finished: { width: number; height: number };
  /** The PDF page: trim + bleed + room for crop marks. */
  page: { width: number; height: number };
  /** Offset of the trim box on the page. */
  trim: { x: number; y: number };
  /** The QR symbol including its quiet zone, at the finished size. */
  qr: number;
  /** Inner safe area margin (3 mm or 5 % of the shorter side, whichever is larger, capped). */
  safe: number;
}

/** The print sizes of a layout (mm layouts; px layouts are converted at 300 dpi before they can print). */
export function printSizes(layout: Layout, s: PrintSettings): PrintSizes {
  const g = layoutGeometry(layout);
  const w = g.width * s.scale;
  const h = g.height * s.scale;
  const marks = s.cropMarks ? CROP_MARK.length + CROP_MARK.gap : 0;
  const edge = s.bleed + marks;
  return {
    finished: { width: r1(w), height: r1(h) },
    page: { width: r1(w + 2 * edge), height: r1(h + 2 * edge) },
    trim: { x: edge, y: edge },
    qr: r1(g.qr[2] * s.scale),
    safe: Math.min(5, Math.max(3, Math.min(w, h) * 0.05)),
  };
}

/** Effective resolution of a raster logo printed `mm` wide: pixels per inch. */
export const effectivePpi = (px: number, mm: number) => (mm > 0 ? Math.round(px / (mm / 25.4)) : 0);
/** The smallest pixel width a logo needs to print `mm` wide at MIN_LOGO_PPI. */
export const pixelsNeeded = (mm: number) => Math.ceil((mm / 25.4) * MIN_LOGO_PPI);

/** sRGB channels of a hex colour, as "R G B". */
export const srgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");

export type PrintRole = "modules" | "corners" | "centers" | "background" | "frame" | "caption";

/** A layout's colours for print: each distinct colour once, with every role that uses it (design 8.x "Colors"). */
export function printColors(layout: Layout): { role: PrintRole; roles: PrintRole[]; hex: string }[] {
  const c = layout.colors;
  const all: { role: PrintRole; hex: string }[] = [
    { role: "modules", hex: c.fg },
    { role: "corners", hex: c.eye },
    { role: "centers", hex: c.eyeIn },
    { role: "caption", hex: c.caption },
    { role: "frame", hex: c.frame },
    { role: "background", hex: c.bg },
  ];
  const out: { role: PrintRole; roles: PrintRole[]; hex: string }[] = [];
  for (const x of all) {
    const same = out.find((o) => o.hex.toUpperCase() === x.hex.toUpperCase());
    if (same) same.roles.push(x.role);
    else out.push({ role: x.role, roles: [x.role], hex: x.hex });
  }
  return out;
}
