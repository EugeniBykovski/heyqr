import type { Layout } from "@heyqr/qr-core";
import type { AnyQrContent } from "./hosted";
import {
  CENTER_ICONS,
  DEFAULT_DESIGN,
  EDITOR_PRESETS,
  hasCaptionBand,
  ORIGINAL_CAPTION_FONT,
  type CaptionAlign,
  type CenterIcon,
  type EditorDesign,
  type EditorPreset,
} from "./design";
import type { LayoutRecordDesign } from "./design-schema";
import { isValidSize } from "./size";

/**
 * HEY-45 "Edit design": the editor state for a saved layout of a saved code. The code gives the type, content, mode and
 * name; the layout's editor settings give every design setting. Records saved before editor settings existed ({ layout }
 * only) are read back from the rendered layout. A layout without a caption font (before HEY-44) keeps its original
 * DM Sans, and one without a caption size keeps the size it was drawn at.
 */
export function designFromSaved(
  qr: { name: string; model: "static" | "dynamic"; content: AnyQrContent },
  record: LayoutRecordDesign,
): EditorDesign {
  const settings = record.editor ?? settingsFromLayout(record.layout);
  const design: EditorDesign = { ...DEFAULT_DESIGN, ...settings, name: qr.name, model: qr.model, content: qr.content };
  if (record.layout.caption.font === undefined) {
    design.captionFont = ORIGINAL_CAPTION_FONT;
    design.captionWeight = record.layout.caption.weight >= 600 ? 700 : 400;
  }
  return design;
}

/** Design settings recovered from a rendered layout (legacy records). */
function settingsFromLayout(layout: Layout): Partial<EditorDesign> {
  const logo = layout.style.logo;
  const icon = logo?.iconPath
    ? (Object.entries(CENTER_ICONS).find(([, path]) => path === logo.iconPath)?.[0] as CenterIcon | undefined)
    : undefined;
  const preset: EditorPreset = (EDITOR_PRESETS as readonly string[]).includes(layout.preset) ? (layout.preset as EditorPreset) : "caption";
  const size = { unit: layout.unit, qr: layout.qrSize ?? layout.width, width: layout.width, height: layout.height };
  return {
    pattern: layout.style.pattern,
    eyeFrame: layout.style.eyeFrame,
    eyeBall: layout.style.eyeBall,
    fg: layout.colors.fg,
    bg: layout.colors.bg,
    eye: layout.colors.eye,
    eyeIn: layout.colors.eyeIn,
    logo: icon
      ? { kind: "icon", icon }
      : logo?.href
        ? { kind: "image", href: logo.href }
        : layout.topLogoHref
          ? { kind: "image", href: layout.topLogoHref }
          : { kind: "none" },
    ...(layout.topLogoHref && !logo ? { logoPosition: "top" as const, ...(layout.brandName ? { brandName: layout.brandName } : {}) } : {}),
    logoSize: logo?.size ?? DEFAULT_DESIGN.logoSize,
    ...(logo ? { logoPlate: logo.plate } : {}),
    preset,
    frameStyle: layout.frameStyle ?? DEFAULT_DESIGN.frameStyle,
    caption: layout.caption.text,
    ...(hasCaptionBand(preset) && layout.caption.align !== "center" ? { captionAlign: layout.caption.align as CaptionAlign } : {}),
    ...(hasCaptionBand(preset) && layout.colors.caption !== layout.colors.fg ? { captionColor: layout.colors.caption } : {}),
    ...(isValidSize(size) ? { size } : {}),
    ...(layout.colors.frame !== layout.colors.fg ? { frameColor: layout.colors.frame } : {}),
    ...(hasCaptionBand(preset) && layout.caption.position !== "after"
      ? { captionPosition: layout.caption.position === "before" ? ("above" as const) : ("inside" as const) }
      : {}),
    ...(preset === "frame" && layout.caption.position === "center" ? { frameTextPosition: "inside" as const } : {}),
    ...(logo?.tile ? { logoTile: true } : {}),
    ...(preset === "frame" && layout.colors.caption !== layout.colors.bg ? { frameTextColor: layout.colors.caption } : {}),
    ...(preset === "caption" && layout.border ? { border: true } : {}),
    ...(layout.style.art ? { art: { tint: layout.style.art.tint, tint2: layout.style.art.tint2 }, designMode: "branded" as const } : {}),
  };
}

/**
 * Edit design, Export and Print Preview pick the requested layout, or without one the first by order (the one My QR
 * codes shows). A requested layout that isn't this code's is undefined (the page 404s), never another design (HEY-81).
 */
export function pickLayoutForEdit<T extends { id: string }>(layouts: T[], layoutId?: string): T | undefined {
  return layoutId ? layouts.find((l) => l.id === layoutId) : layouts[0];
}
