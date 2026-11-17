export type ModuleShape = "square" | "rounded" | "dot" | "diamond" | "leaf" | "fluid" | "vbars" | "hbars";
export type EyeFrameShape = "square" | "rounded" | "cushion" | "circle" | "leaf";
export type EyeBallShape = "square" | "rounded" | "circle" | "diamond" | "leaf";
export type PlateShape = "none" | "square" | "circle";

export interface QrColors {
  /** Data modules. */
  fg: string;
  /** Corner-marker frames. */
  eye: string;
  /** Corner-marker centers (also the default icon color). */
  eyeIn: string;
  bg: string;
}

export interface QrLogo {
  /** Raster/SVG image URL or data URI. Ignored when `iconPath` is set. */
  href?: string;
  /** 24×24 stroke icon path (Lucide geometry). */
  iconPath?: string;
  /** Logo width as a fraction of the symbol width (0.08–0.46). */
  size: number;
  plate: PlateShape;
  /** Icon on a colored rounded tile instead of a plate. */
  tile?: boolean;
  plateColor?: string;
  iconColor?: string;
}

export interface QrCenterText {
  text: string;
  bg: string;
  color: string;
  fontFamily: string;
}

export interface QrStyle {
  pattern: ModuleShape;
  eyeFrame: EyeFrameShape;
  eyeBall: EyeBallShape;
  colors: QrColors;
  logo?: QrLogo | null;
  centerText?: QrCenterText | null;
}

export type ScanIssueCode = "invert" | "contrast" | "eyes" | "logo" | "text";

export interface ScanIssue {
  code: ScanIssueCode;
  title: string;
  detail: string;
  fix: string;
}

export interface ScanReport {
  ok: boolean;
  issues: ScanIssue[];
  /** Largest logo size (fraction of symbol) that still decodes; 0 when no logo. */
  maxLogoSize: number;
  version: number;
  ecl: "L" | "M" | "Q" | "H";
  modules: number;
}

export interface RenderedQr {
  /** SVG markup without the outer <svg> element, in module units including a 4-module quiet zone. */
  inner: string;
  /** Width and height of the symbol including quiet zone, in modules. */
  viewBox: number;
  scan: ScanReport;
}

export type LayoutPreset = "qr" | "caption" | "vertical" | "horizontal" | "frame";
export type FrameStyle = "bar" | "tab" | "bubble" | "pill" | "corners" | "circle" | "ticket" | "phone";
export type CaptionPosition = "after" | "before" | "center";

export interface LayoutCaption {
  text: string;
  /** CSS font-family list. */
  fontFamily: string;
  /** pt for mm layouts, px for px layouts. */
  size: number;
  weight: number;
  align: "left" | "center" | "right";
  position: CaptionPosition;
}

export interface Layout {
  preset: LayoutPreset;
  frameStyle?: FrameStyle;
  unit: "mm" | "px";
  width: number;
  height: number;
  /** QR size including the quiet zone, in layout units. */
  qrSize: number;
  /** Hairline border around caption/card layouts. */
  border: boolean;
  colors: QrColors & { frame: string; caption: string };
  style: Omit<QrStyle, "colors" | "centerText">;
  caption: LayoutCaption;
  /** Logo shown above the code on vertical/horizontal cards. */
  topLogoHref?: string;
  brandName?: string;
}
