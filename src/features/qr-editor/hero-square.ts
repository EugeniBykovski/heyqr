import { DEFAULT_DESIGN, type EditorDesign } from "@/entities/qr";

/** HEY-187: the homepage demo: a 44 mm code with its caption on a 60 × 60 mm square (the homepage only). */
export const HERO_SQUARE = { unit: "mm", qr: 44, width: 60, height: 60 } as const;

/** The design the homepage hero starts from: square QR + caption, a bold scan line under the code. */
export const heroDesign = (caption: string): EditorDesign => ({
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption,
  captionWeight: 700,
  size: HERO_SQUARE,
});
