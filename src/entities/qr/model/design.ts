import type { EyeBallShape, EyeFrameShape, FrameStyle, Layout, ModuleShape, QrContent } from "@heyqr/qr-core";

/** 24×24 stroke icons for the code center (Lucide geometry, drawn by qr-core). */
export const CENTER_ICONS = {
  globe:
    "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10a15.3 15.3 0 0 1-4 10a15.3 15.3 0 0 1-4-10a15.3 15.3 0 0 1 4-10z",
  wifi: "M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0",
  phone:
    "M22 16.92v3a2 2 0 0 1-2.18 2a19.79 19.79 0 0 1-8.63-3.07a19.5 19.5 0 0 1-6-6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72a12.84 12.84 0 0 0 .7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45a12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7",
  heart:
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2c-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87l1.18 6.88L12 17.77l-6.18 3.25L7 14.14L2 9.27l6.91-1.01L12 2z",
  coffee: "M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2",
  pin: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0M12 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
} as const;
export type CenterIcon = keyof typeof CENTER_ICONS;

export const MODULE_SHAPES: readonly ModuleShape[] = ["square", "rounded", "dot", "diamond", "leaf", "fluid", "vbars", "hbars"];
export const EYE_FRAME_SHAPES: readonly EyeFrameShape[] = ["square", "rounded", "cushion", "circle", "leaf"];
export const EYE_BALL_SHAPES: readonly EyeBallShape[] = ["square", "rounded", "circle", "diamond", "leaf"];
export const FRAME_STYLES: readonly FrameStyle[] = ["bar", "tab", "bubble", "pill", "corners", "circle", "ticket", "phone"];
export type EditorPreset = "qr" | "caption" | "frame";
export const EDITOR_PRESETS: readonly EditorPreset[] = ["qr", "caption", "frame"];

export type CenterLogo = { kind: "none" } | { kind: "icon"; icon: CenterIcon } | { kind: "image"; href: string };

/** Everything the editor edits. Serializable: it is the guest draft in localStorage. */
export interface EditorDesign {
  name: string;
  model: "static" | "dynamic";
  content: QrContent;
  pattern: ModuleShape;
  eyeFrame: EyeFrameShape;
  eyeBall: EyeBallShape;
  fg: string;
  bg: string;
  logo: CenterLogo;
  logoSize: number;
  preset: EditorPreset;
  frameStyle: FrameStyle;
  caption: string;
}

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

/** Screen base size in px; PNG exports scale it (2× by default, up to 8192 px). */
const BASE = 512;

export function designToLayout(d: EditorDesign): Layout {
  const logo =
    d.logo.kind === "icon"
      ? { iconPath: CENTER_ICONS[d.logo.icon], size: d.logoSize, plate: "circle" as const, plateColor: d.bg, iconColor: d.fg }
      : d.logo.kind === "image"
        ? { href: d.logo.href, size: d.logoSize, plate: "square" as const, plateColor: d.bg }
        : null;
  const captionText = d.preset === "qr" ? "" : d.caption;
  return {
    preset: d.preset,
    frameStyle: d.preset === "frame" ? d.frameStyle : undefined,
    unit: "px",
    width: BASE,
    height: d.preset === "caption" ? Math.round(BASE * 1.22) : BASE,
    qrSize: BASE,
    border: false,
    colors: { fg: d.fg, eye: d.fg, eyeIn: d.fg, bg: d.bg, frame: d.fg, caption: d.preset === "frame" ? d.bg : d.fg },
    style: { pattern: d.pattern, eyeFrame: d.eyeFrame, eyeBall: d.eyeBall, logo },
    caption: { text: captionText, fontFamily: "DM Sans, sans-serif", size: 40, weight: 700, align: "center", position: "after" },
  };
}
