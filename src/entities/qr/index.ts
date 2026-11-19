export {
  CENTER_ICONS,
  DEFAULT_DESIGN,
  EDITOR_PRESETS,
  EYE_BALL_SHAPES,
  EYE_FRAME_SHAPES,
  FRAME_STYLES,
  MODULE_SHAPES,
  ORIGINAL_CAPTION_FONT,
  QR_INKS,
  designToLayout,
  type CenterIcon,
  type CenterLogo,
  type EditorDesign,
  type EditorPreset,
} from "./model/design";
export {
  CAPTION_MAX_CHARS,
  CAPTION_MAX_LINES,
  CAPTION_SIZE_LIMITS,
  captionLength,
  captionSizeUnit,
  checkCaption,
  convertCaptionSize,
  defaultCaptionSize,
  MM_PER_PT,
  normalizeCaption,
  parseCaptionSize,
  type CaptionCheck,
  type CaptionSizeUnit,
} from "./model/caption";
export { CONTENT_FIELDS, emptyContent, isContentComplete, type ContentField } from "./model/content";
export { QrPreview } from "./ui/qr-preview";
export { designFromSaved, pickLayoutForEdit } from "./model/saved-design";
export { CaptionFontFaces, captionFontUrl } from "./ui/caption-font-faces";
export { captionFontQueries, useCaptionFontsReady } from "./model/use-caption-fonts-ready";
export { QR_EXAMPLES, type QrExample } from "./model/examples";
export {
  createLayoutRecord,
  DESIGN_SCHEMA_VERSION,
  designSettingsOf,
  designSettingsSchema,
  readDraftDesign,
  readLayoutRecord,
  serializeDraftDesign,
  type DesignSettings,
  type LayoutRecordDesign,
  type ReadResult,
} from "./model/design-schema";
export { MODES_BY_TYPE, modeFor, QR_MODES, supportsMode, type QrMode } from "./model/modes";
export {
  convertSize,
  isValidSize,
  LEGACY_SIZE,
  MM_PRESETS,
  PX_PER_MM,
  parseSizeValue,
  presetSize,
  PX_PRESETS,
  SIZE_LIMITS,
  sizeLimits,
  type DesignSize,
  type SizeField,
  type SizeUnit,
} from "./model/size";
