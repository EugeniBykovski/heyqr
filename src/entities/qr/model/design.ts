import {
  CAPTION_FONTS,
  captionFontFamily,
  captionWeightFor,
  DEFAULT_CAPTION_FONT,
  DEFAULT_CAPTION_WEIGHT,
  LABEL_ON_FRAME,
  type CaptionFontId,
  type CaptionWeight,
  type EyeBallShape,
  type EyeFrameShape,
  type FrameStyle,
  type Layout,
  type ModuleShape,
  type QrContent,
} from "@heyqr/qr-core";
import { defaultCaptionSize } from "./caption";
import { LEGACY_SIZE, type DesignSize } from "./size";

/**
 * 24×24 stroke icons for the code center (Lucide geometry, drawn by qr-core): the design's 38-icon library (1.11).
 * The first eight keep the exact paths they were saved with, so stored layouts render unchanged.
 */
export const CENTER_ICONS = {
  globe:
    "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10a15.3 15.3 0 0 1-4 10a15.3 15.3 0 0 1-4-10a15.3 15.3 0 0 1 4-10z",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  wifi: "M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0",
  phone:
    "M22 16.92v3a2 2 0 0 1-2.18 2a19.79 19.79 0 0 1-8.63-3.07a19.5 19.5 0 0 1-6-6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72a12.84 12.84 0 0 0 .7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45a12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7",
  message: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
  pin: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0M12 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  calendar: "M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6v6l4 2",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  briefcase: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  bag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  cart: "M8 19a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM19 19a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",
  coffee: "M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2",
  utensils: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zM21 15v7",
  wine: "M8 22h8M7 10h10M12 15v7M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z",
  music: "M9 18V5l12-2v13M6 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM18 13a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  play: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM10 8l6 4-6 4z",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 10a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
  image:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21",
  heart:
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2c-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87l1.18 6.88L12 17.77l-6.18 3.25L7 14.14L2 9.27l6.91-1.01L12 2z",
  gift: "M3 8h18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5",
  ticket: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2",
  tag: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7.5 6.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2z",
  percent: "M19 5 5 19M6.5 4a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM17.5 15a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
  card: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8",
  book: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
  leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10zM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
  bike: "M5.5 14.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM18.5 14.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM15 4a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM12 17.5V14l-3-3 4-3 2 3h2",
  plane:
    "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  at: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",
  smile: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
} as const;
export type CenterIcon = keyof typeof CENTER_ICONS;

export const MODULE_SHAPES: readonly ModuleShape[] = ["square", "rounded", "dot", "diamond", "leaf", "fluid", "vbars", "hbars"];
export const EYE_FRAME_SHAPES: readonly EyeFrameShape[] = ["square", "rounded", "cushion", "circle", "leaf"];
export const EYE_BALL_SHAPES: readonly EyeBallShape[] = ["square", "rounded", "circle", "diamond", "leaf"];
export const FRAME_STYLES: readonly FrameStyle[] = ["bar", "tab", "bubble", "pill", "corners", "circle", "ticket", "phone"];
export type EditorPreset = "qr" | "caption" | "vertical" | "horizontal" | "frame";
/** Design "Layout": QR only, QR + caption, Vertical card, Horizontal card (HEY-53), Frame. */
export const EDITOR_PRESETS: readonly EditorPreset[] = ["qr", "caption", "vertical", "horizontal", "frame"];
/** Layouts with a caption band of their own (caption text, font, size, alignment and colour apply). */
export const hasCaptionBand = (preset: EditorPreset) => preset === "caption" || preset === "vertical" || preset === "horizontal";
/**
 * Card proportions from the design's presets (mm): Vertical card 55 × 85 with a 41 mm code, Horizontal card 90 × 50 with
 * a 35 mm code. Cards size themselves from the code, like QR only and Frame, so switching layouts never changes the
 * QR + caption layout's own width and height.
 */
export const CARD_RATIO: Record<"vertical" | "horizontal", { width: number; height: number }> = {
  vertical: { width: 55 / 41, height: 85 / 41 },
  horizontal: { width: 90 / 35, height: 50 / 35 },
};

export type CenterLogo = { kind: "none" } | { kind: "icon"; icon: CenterIcon } | { kind: "image"; href: string };

/** Everything the editor edits. Serializable: it is the guest draft in localStorage. */
export interface EditorDesign {
  name: string;
  model: "static" | "dynamic";
  content: QrContent;
  pattern: ModuleShape;
  eyeFrame: EyeFrameShape;
  eyeBall: EyeBallShape;
  /** Data modules. */
  fg: string;
  bg: string;
  /** Corner frames (finder rings) and corner centres. Unset = follow `fg`, as before they could be set (HEY-33). */
  eye?: string;
  eyeIn?: string;
  logo: CenterLogo;
  logoSize: number;
  /** Logo backing (HEY-51, design "plate"): none, square or circle. Unset = the look every logo had: square behind an
   *  uploaded image, circle behind an icon. */
  logoPlate?: LogoPlate;
  preset: EditorPreset;
  frameStyle: FrameStyle;
  caption: string;
  /** Caption font and weight (HEY-44). Unset (drafts before HEY-44) = DEFAULT_CAPTION_FONT / DEFAULT_CAPTION_WEIGHT. */
  captionFont?: CaptionFontId | typeof ORIGINAL_CAPTION_FONT;
  captionWeight?: CaptionWeight;
  /** Caption alignment within its band (HEY-46). Unset = center, as every layout before. Caption layout only. */
  captionAlign?: CaptionAlign;
  /** Caption text colour (HEY-46). Unset = the module colour, as every layout before. Caption layout only. */
  captionColor?: string;
  /** Caption type size (HEY-45): px for px layouts, pt for mm layouts. Unset = defaultCaptionSize (older layouts). */
  captionSize?: number;
  /**
   * HEY-59: the card canvas (Vertical / Horizontal card) as chosen in Size, independent of the code size. Unset (cards
   * from before HEY-59, or never resized): the card keeps its design proportions from the code (CARD_RATIO).
   */
  cardSize?: { width: number; height: number };
  /** Design 1.8 Size. Unset (every draft before HEY-35) renders at LEGACY_SIZE, exactly as before. */
  size?: DesignSize;
  /** Design "Colors · Frame": the frame and card border colour. Unset = the module colour, as before. */
  frameColor?: string;
  /** Design 1.15 "Text color" of a frame's label. Unset = the background colour, as before (HEY-46: the caption colour
   *  never applies to frames). */
  frameTextColor?: string;
  /** Design 1.16: caption below, above or inside the code (QR + caption and cards). Unset = below, as before. */
  captionPosition?: CaptionPosition;
  /** Design 1.15 "Color tile": a centre icon on a tile in the corner-center colour instead of a plate. */
  logoTile?: boolean;
  /** Design "Frame around the layout" for QR + caption (cards always have one). Unset = none, as before. */
  border?: boolean;
  /** Design "Logo → Position": an uploaded image in the code's centre or above the code on a card. Unset = centre. */
  logoPosition?: "center" | "top";
  /** Design 2.8 Brand card: the name beside the logo above the code (cards with a top logo). */
  brandName?: string;
  /** Design 2.4: Custom or Branded. Unset = the chooser hasn't been answered (new drafts); behaves as Custom. */
  designMode?: "custom" | "branded";
  /** Design 2.6: colours read from the uploaded image (the image itself is `logo`), and its file name. */
  brand?: { palette: string[]; name?: string };
  /** Design 2.7: the branded look last applied. */
  look?: "center" | "card" | "art";
  /** Design 2.7 Artwork: tints of the shapes behind the code (the uploaded image is drawn faint behind them). */
  art?: { tint: string; tint2: string };
}

/** An uploaded image sits above the code only on the cards; everywhere else it stays in the centre. */
export const logoOnTop = (d: Pick<EditorDesign, "preset" | "logo" | "logoPosition">) =>
  d.logoPosition === "top" && d.logo.kind === "image" && (d.preset === "vertical" || d.preset === "horizontal");

export type CaptionPosition = "below" | "above" | "inside";
export const CAPTION_POSITIONS: readonly CaptionPosition[] = ["below", "above", "inside"];
const LAYOUT_CAPTION_POSITION = { below: "after", above: "before", inside: "center" } as const;

export type CaptionAlign = "left" | "center" | "right";
export type LogoPlate = "none" | "square" | "circle";
export const LOGO_PLATES: readonly LogoPlate[] = ["none", "square", "circle"];
/** The backing a logo has when none was chosen. */
export const defaultLogoPlate = (logo: CenterLogo): LogoPlate => (logo.kind === "icon" ? "circle" : "square");
export const CAPTION_ALIGNS: readonly CaptionAlign[] = ["left", "center", "right"];
/**
 * The frame label's colour when none was chosen: the background colour on frames whose label sits on the frame band,
 * the frame colour on frames whose label sits on the background (Corners, Phone), so it is never drawn invisibly.
 */
export const defaultFrameTextColor = (d: Pick<EditorDesign, "frameStyle" | "frameColor" | "fg" | "bg">): string =>
  LABEL_ON_FRAME[d.frameStyle] ? d.bg : (d.frameColor ?? d.fg);

/** The alignment a caption has when none was chosen: left beside the code on the horizontal card, centred elsewhere. */
export const defaultCaptionAlign = (preset: EditorPreset): CaptionAlign => (preset === "horizontal" ? "left" : "center");

export const DEFAULT_DESIGN: EditorDesign = {
  name: "",
  model: "static",
  content: { type: "website", url: "" },
  pattern: "rounded",
  eyeFrame: "rounded",
  eyeBall: "rounded",
  fg: "#0D0D12",
  bg: "#FFFFFF",
  logo: { kind: "none" },
  logoSize: 0.22,
  preset: "qr",
  frameStyle: "bar",
  caption: "",
};

/** Customer code colours offered as quick swatches (design: Ink, Violet, Forest, Ocean, Berry, Clay). QR data, not UI tokens. */
export const QR_INKS = [
  { hex: "#0D0D12", name: "ink" },
  { hex: "#4B2EE0", name: "violet" },
  { hex: "#1F5C45", name: "forest" },
  { hex: "#1F4E8C", name: "ocean" },
  { hex: "#8C2F4B", name: "berry" },
  { hex: "#9A4A22", name: "clay" },
] as const;

/** Design 1.12 Quick styles: shapes and colours set together in one step (QR data, not UI tokens). */
export const QUICK_STYLES = [
  { id: "classic", pattern: "square", eyeFrame: "square", eyeBall: "square", fg: "#0D0D12", bg: "#FFFFFF" },
  { id: "soft", pattern: "rounded", eyeFrame: "rounded", eyeBall: "rounded", fg: "#1F4E8C", bg: "#EEF3FA" },
  { id: "dots", pattern: "dot", eyeFrame: "circle", eyeBall: "circle", fg: "#8C2F4B", bg: "#FBEFF2" },
  { id: "fluid", pattern: "fluid", eyeFrame: "cushion", eyeBall: "rounded", fg: "#1F5C45", bg: "#EEF6F0" },
  { id: "lines", pattern: "vbars", eyeFrame: "rounded", eyeBall: "circle", fg: "#0D0D12", bg: "#FBF7F0" },
  { id: "gem", pattern: "diamond", eyeFrame: "leaf", eyeBall: "diamond", fg: "#4B2EE0", bg: "#F5F3FF" },
] as const satisfies readonly {
  id: string;
  pattern: ModuleShape;
  eyeFrame: EyeFrameShape;
  eyeBall: EyeBallShape;
  fg: string;
  bg: string;
}[];
/** "Surprise me" colour pairs: code colour on a light background that keeps the contrast the scan check wants. */
export const SURPRISE_COLORS = [
  ["#0D0D12", "#FFFFFF"],
  ["#1F4E8C", "#EEF3FA"],
  ["#8C2F4B", "#FBEFF2"],
  ["#1F5C45", "#EEF6F0"],
  ["#4B2EE0", "#F5F3FF"],
  ["#9A4A22", "#FFF6DA"],
] as const;

/** A quick style as one patch: shapes and colours, with every colour role following the code colour again. */
export function quickStylePatch({
  pattern,
  eyeFrame,
  eyeBall,
  fg,
  bg,
}: Pick<EditorDesign, "pattern" | "eyeFrame" | "eyeBall" | "fg" | "bg">): Partial<EditorDesign> {
  // Only design settings: a preset's own fields (its id) never enter the draft.
  return { pattern, eyeFrame, eyeBall, fg, bg, eye: undefined, eyeIn: undefined, frameColor: undefined, captionColor: undefined };
}

/** Design 1.15 frame colour presets: frame · code · background. */
export const FRAME_COMBOS = [
  ["#0D0D12", "#0D0D12", "#FFFFFF"],
  ["#1F4D3A", "#1F7A6B", "#FFFFFF"],
  ["#0B1B4D", "#1F4ED8", "#FFFFFF"],
  ["#3A2412", "#C8102E", "#FFFFFF"],
  ["#5B3BFF", "#0D0D12", "#FFFFFF"],
  ["#5F5F5F", "#1D4743", "#FFFFFF"],
] as const;
/** Design 1.15 frame text: at most this many characters; quick phrases (message keys). */
export const FRAME_TEXT_MAX = 16;
export const FRAME_PHRASES = ["scanMe", "callMe", "menu", "wifi", "payHere", "reviewUs", "followUs", "bookNow"] as const;

/**
 * A layout saved before caption fonts (HEY-44) has no font ID and keeps DM Sans (Latin only, 400 / 700) when it is
 * reopened for editing, so editing it doesn't change its look until another font is chosen (HEY-45).
 */
export const ORIGINAL_CAPTION_FONT = "dm-original" as const;

/** Caption font, family, and the weight actually drawn, for the layout. */
function captionTypeface(d: EditorDesign): Pick<Layout["caption"], "font" | "fontFamily" | "weight"> {
  const weight = d.captionWeight ?? DEFAULT_CAPTION_WEIGHT;
  if (d.captionFont === ORIGINAL_CAPTION_FONT)
    return { font: undefined, fontFamily: "DM Sans, sans-serif", weight: weight >= 600 ? 700 : 400 };
  const font = d.captionFont ?? DEFAULT_CAPTION_FONT;
  return { font, fontFamily: captionFontFamily(CAPTION_FONTS[font]), weight: captionWeightFor(font, weight) };
}

export function designToLayout(d: EditorDesign): Layout {
  const top = logoOnTop(d) && d.logo.kind === "image" ? d.logo.href : undefined;
  const logo = top
    ? null
    : d.logo.kind === "icon"
      ? d.logoTile
        ? { iconPath: CENTER_ICONS[d.logo.icon], size: d.logoSize, plate: "square" as const, tile: true }
        : { iconPath: CENTER_ICONS[d.logo.icon], size: d.logoSize, plate: d.logoPlate ?? "circle", plateColor: d.bg, iconColor: d.fg }
      : d.logo.kind === "image"
        ? { href: d.logo.href, size: d.logoSize, plate: d.logoPlate ?? "square", plateColor: d.bg }
        : null;
  const captionText = d.preset === "qr" ? "" : d.caption;
  const size = d.size ?? LEGACY_SIZE;
  // "qr" and "frame" derive their canvas from the code (layoutGeometry); "caption" has its own width × height.
  const round = (v: number) => (size.unit === "mm" ? Math.round(v * 10) / 10 : Math.round(v));
  const canvas =
    d.preset === "caption"
      ? { width: size.width, height: size.height }
      : d.preset === "vertical" || d.preset === "horizontal"
        ? (d.cardSize ?? { width: round(size.qr * CARD_RATIO[d.preset].width), height: round(size.qr * CARD_RATIO[d.preset].height) })
        : { width: size.qr, height: size.qr };
  return {
    preset: d.preset,
    frameStyle: d.preset === "frame" ? d.frameStyle : undefined,
    unit: size.unit,
    ...canvas,
    qrSize: size.qr,
    border: d.preset === "caption" && d.border === true,
    colors: {
      fg: d.fg,
      eye: d.eye ?? d.fg,
      eyeIn: d.eyeIn ?? d.fg,
      bg: d.bg,
      frame: d.frameColor ?? d.fg,
      // The frame label keeps its own styling; captions may have their own colour.
      caption: d.preset === "frame" ? (d.frameTextColor ?? defaultFrameTextColor(d)) : (d.captionColor ?? d.fg),
    },
    style: {
      pattern: d.pattern,
      eyeFrame: d.eyeFrame,
      eyeBall: d.eyeBall,
      logo,
      ...(d.art ? { art: { ...d.art, ...(d.logo.kind === "image" ? { image: d.logo.href } : {}) } } : {}),
    },
    ...(top ? { topLogoHref: top, ...(d.brandName?.trim() ? { brandName: d.brandName.trim() } : {}) } : {}),
    caption: {
      text: captionText,
      ...captionTypeface(d),
      // px layouts: px. mm layouts: pt (the renderer's caption unit for print). Unset: a share of the code, as before.
      size: d.captionSize ?? defaultCaptionSize(size, d.preset),
      // Frames centre their label; the caption layout aligns its lines as chosen (HEY-46).
      // The horizontal card's caption sits beside the code, left-aligned by default (design preset); others centre.
      align: hasCaptionBand(d.preset) ? (d.captionAlign ?? defaultCaptionAlign(d.preset)) : "center",
      position: hasCaptionBand(d.preset) ? LAYOUT_CAPTION_POSITION[d.captionPosition ?? "below"] : "after",
    },
  };
}
