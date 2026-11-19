import { CAPTION_FONT_IDS, isHexColor, QR_CONTENT_TYPES, type Layout, type QrContent } from "@heyqr/qr-core";
import { checkLogoDataUrl } from "./logo";
import { isValidSize } from "./size";
import { z } from "zod";
import { modeFor, QR_MODES } from "./modes";
import {
  CAPTION_ALIGNS,
  CENTER_ICONS,
  EDITOR_PRESETS,
  ORIGINAL_CAPTION_FONT,
  EYE_BALL_SHAPES,
  EYE_FRAME_SHAPES,
  FRAME_STYLES,
  MODULE_SHAPES,
  type EditorDesign,
} from "./design";

/*
 * Versioned QR design JSON (schemaVersion 1). Two stored formats use it:
 *
 *   Guest draft        localStorage "heyqr:draft:v1"  { schemaVersion, name, model, content, ...design settings }
 *   Saved variant      qr_layout.design (jsonb)       { schemaVersion, layout, editor?: design settings }
 *
 * schemaVersion versions the JSON contract below. The ":v1" in the storage key only names the browser slot;
 * it changes if drafts ever move to a different key or storage, not when the JSON shape changes.
 * Records written before versioning (no schemaVersion) are read as their known shape and upgraded on the next write.
 */
export const DESIGN_SCHEMA_VERSION = 1 as const;

const oneOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]);
/** Same rule as the editor and renderer (qr-core isHexColor): "#RRGGBB", either letter case. */
const hex = z.string().refine(isHexColor);

/** The editor's design settings: everything that styles a code, without its content or name. */
export const designSettingsSchema = z.object({
  pattern: oneOf(MODULE_SHAPES),
  eyeFrame: oneOf(EYE_FRAME_SHAPES),
  eyeBall: oneOf(EYE_BALL_SHAPES),
  fg: hex,
  bg: hex,
  // Optional: drafts and records from before HEY-33 have no finder colours; they follow fg.
  eye: hex.optional(),
  eyeIn: hex.optional(),
  logo: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("icon"), icon: oneOf(Object.keys(CENTER_ICONS) as (keyof typeof CENTER_ICONS)[]) }),
    z.object({ kind: z.literal("image"), href: z.string().min(1) }),
  ]),
  logoSize: z.number().min(0).max(1),
  preset: oneOf(EDITOR_PRESETS),
  frameStyle: oneOf(FRAME_STYLES),
  caption: z.string().max(200),
  // Optional: drafts and records from before HEY-44 have no caption font; they get the default.
  captionFont: oneOf([...CAPTION_FONT_IDS, ORIGINAL_CAPTION_FONT]).optional(),
  captionWeight: z.union([z.literal(400), z.literal(500), z.literal(700)]).optional(),
  // Optional: before HEY-46 captions were centred in the module colour.
  captionAlign: oneOf(CAPTION_ALIGNS).optional(),
  captionColor: hex.optional(),
  // Optional: before HEY-45 the caption size followed the code size (defaultCaptionSize).
  captionSize: z.number().min(4).max(400).optional(),
  // Optional: drafts and records from before HEY-35 have no size and render at LEGACY_SIZE.
  size: z
    .object({ unit: z.enum(["px", "mm"]), qr: z.number(), width: z.number(), height: z.number() })
    .refine(isValidSize)
    .optional(),
});
export type DesignSettings = z.infer<typeof designSettingsSchema>;

const contentSchema = z
  .object({ type: oneOf(QR_CONTENT_TYPES) })
  .catchall(z.union([z.string(), z.boolean()]))
  .transform((c) => c as unknown as QrContent);

const draftFields = designSettingsSchema.extend({
  name: z.string().max(80),
  model: z.enum(QR_MODES),
  content: contentSchema,
});

/** Rendered layout (qr-core `Layout`): the core fields are checked, optional extras pass through. */
const layoutSchema = z
  .looseObject({
    preset: z.enum(["qr", "caption", "vertical", "horizontal", "frame"]),
    frameStyle: oneOf(FRAME_STYLES).optional(),
    unit: z.enum(["mm", "px"]),
    width: z.number().positive(),
    height: z.number().positive(),
    qrSize: z.number().positive(),
    border: z.boolean(),
    colors: z.looseObject({ fg: z.string(), eye: z.string(), eyeIn: z.string(), bg: z.string(), frame: z.string(), caption: z.string() }),
    style: z.looseObject({ pattern: oneOf(MODULE_SHAPES), eyeFrame: oneOf(EYE_FRAME_SHAPES), eyeBall: oneOf(EYE_BALL_SHAPES) }),
    caption: z.looseObject({
      text: z.string(),
      fontFamily: z.string(),
      // HEY-44; absent on older layouts (DM Sans). An unknown ID is refused rather than rendered with the wrong font.
      font: oneOf(CAPTION_FONT_IDS).optional(),
      size: z.number(),
      weight: z.number(),
      align: z.enum(["left", "center", "right"]),
      position: z.enum(["after", "before", "center"]),
    }),
  })
  .transform((l) => l as unknown as Layout);

/** Saved design variant (qr_layout.design). `editor` keeps the settings so the variant can be reopened for editing. */
export type LayoutRecordDesign = { schemaVersion: typeof DESIGN_SCHEMA_VERSION; layout: Layout; editor?: DesignSettings };

export type ReadResult<T> =
  | { ok: true; value: T; from: "current" | "legacy"; adjusted?: "mode" }
  | { ok: false; reason: "malformed" | "unsupported"; version?: unknown };

/** Splits a raw record into its version: missing → legacy, 1 → current, another number → unsupported. */
function versionOf(raw: unknown): "legacy" | "current" | "unsupported" | "malformed" {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "malformed";
  if (!("schemaVersion" in raw)) return "legacy";
  const v = (raw as { schemaVersion: unknown }).schemaVersion;
  if (v === DESIGN_SCHEMA_VERSION) return "current";
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? "unsupported" : "malformed";
}

/** Canonical reader for the guest draft. Legacy drafts (no schemaVersion) keep every setting they have. */
export function readDraftDesign(raw: unknown, defaults: EditorDesign): ReadResult<EditorDesign> {
  const kind = versionOf(raw);
  if (kind === "malformed") return { ok: false, reason: "malformed" };
  if (kind === "unsupported") return { ok: false, reason: "unsupported", version: (raw as { schemaVersion: unknown }).schemaVersion };
  // Legacy drafts were saved as a full or partial EditorDesign merged over the defaults; read them the same way.
  const candidate = kind === "legacy" ? { ...defaults, ...(raw as object) } : raw;
  const parsed = draftFields.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const draft = parsed.data as EditorDesign;
  // Earlier builds let any type be dynamic. Keep the draft, but switch an unsupported mode to static and say so.
  const model = modeFor(draft.content.type, draft.model);
  if (model !== draft.model) return { ok: true, value: { ...draft, model }, from: kind, adjusted: "mode" };
  return { ok: true, value: draft, from: kind };
}

/** What the browser stores: the draft plus the contract version. */
export function serializeDraftDesign(design: EditorDesign): EditorDesign & { schemaVersion: typeof DESIGN_SCHEMA_VERSION } {
  return { schemaVersion: DESIGN_SCHEMA_VERSION, ...design };
}

/** Canonical reader for qr_layout.design. Legacy records were `{ layout }` with no editor settings. */
export function readLayoutRecord(raw: unknown): ReadResult<LayoutRecordDesign> {
  const kind = versionOf(raw);
  if (kind === "malformed") return { ok: false, reason: "malformed" };
  if (kind === "unsupported") return { ok: false, reason: "unsupported", version: (raw as { schemaVersion: unknown }).schemaVersion };
  const record = raw as { layout?: unknown; editor?: unknown };
  const layout = layoutSchema.safeParse(record.layout);
  if (!layout.success) return { ok: false, reason: "malformed" };
  const editor = record.editor === undefined ? undefined : designSettingsSchema.safeParse(record.editor);
  if (editor && !editor.success) return { ok: false, reason: "malformed" };
  return {
    ok: true,
    value: { schemaVersion: DESIGN_SCHEMA_VERSION, layout: layout.data, ...(editor ? { editor: editor.data } : {}) },
    from: kind,
  };
}

/** A logo the server stores: an uploaded file kept in our storage (URL) or an inline image that passes the logo rule. */
const acceptableLogoHref = (href: string | undefined) => href === undefined || /^https?:\/\//.test(href) || checkLogoDataUrl(href).ok;

/**
 * Builds the record the server writes for a variant; validates both parts first. New writes also apply the logo rule
 * (HEY-50: PNG, JPEG, WebP or SVG by content, at most 10 MB); reading stays lenient so older records still open.
 */
export function createLayoutRecord(layout: unknown, editor?: unknown): LayoutRecordDesign | null {
  const result = readLayoutRecord({ schemaVersion: DESIGN_SCHEMA_VERSION, layout, ...(editor === undefined ? {} : { editor }) });
  if (!result.ok) return null;
  const editorLogo = result.value.editor?.logo;
  if (!acceptableLogoHref(result.value.layout.style.logo?.href)) return null;
  if (editorLogo?.kind === "image" && !acceptableLogoHref(editorLogo.href)) return null;
  return result.value;
}

/** The design settings part of an editor draft (what a saved variant keeps in `editor`). */
export function designSettingsOf(design: EditorDesign): DesignSettings {
  const {
    pattern,
    eyeFrame,
    eyeBall,
    fg,
    bg,
    eye,
    eyeIn,
    logo,
    logoSize,
    preset,
    frameStyle,
    caption,
    captionFont,
    captionWeight,
    captionSize,
    captionAlign,
    captionColor,
    size,
  } = design;
  return {
    pattern,
    eyeFrame,
    eyeBall,
    fg,
    bg,
    ...(eye === undefined ? {} : { eye }),
    ...(eyeIn === undefined ? {} : { eyeIn }),
    logo,
    logoSize,
    preset,
    frameStyle,
    caption,
    ...(captionFont === undefined ? {} : { captionFont }),
    ...(captionWeight === undefined ? {} : { captionWeight }),
    ...(captionSize === undefined ? {} : { captionSize }),
    ...(captionAlign === undefined ? {} : { captionAlign }),
    ...(captionColor === undefined ? {} : { captionColor }),
    ...(size === undefined ? {} : { size }),
  };
}
