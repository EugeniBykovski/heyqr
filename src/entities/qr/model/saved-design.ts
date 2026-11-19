import type { Layout, QrContent } from "@heyqr/qr-core";
import {
  CENTER_ICONS,
  DEFAULT_DESIGN,
  EDITOR_PRESETS,
  ORIGINAL_CAPTION_FONT,
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
  qr: { name: string; model: "static" | "dynamic"; content: QrContent },
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
    logo: icon ? { kind: "icon", icon } : logo?.href ? { kind: "image", href: logo.href } : { kind: "none" },
    logoSize: logo?.size ?? DEFAULT_DESIGN.logoSize,
    preset,
    frameStyle: layout.frameStyle ?? DEFAULT_DESIGN.frameStyle,
    caption: layout.caption.text,
    ...(isValidSize(size) ? { size } : {}),
  };
}

/** Edit design picks the requested layout, or without one the first by order (the one My QR codes shows). */
export function pickLayoutForEdit<T extends { id: string }>(layouts: T[], layoutId?: string): T | undefined {
  return layoutId ? layouts.find((l) => l.id === layoutId) : layouts[0];
}
