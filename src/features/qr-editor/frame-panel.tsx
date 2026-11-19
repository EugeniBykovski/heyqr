"use client";

import {
  CAPTION_FONT_IDS,
  CAPTION_FONTS,
  captionFontFamily,
  captionWeightFor,
  DEFAULT_CAPTION_FONT,
  DEFAULT_CAPTION_WEIGHT,
  supportedWeights,
} from "@heyqr/qr-core";
import { useTranslations } from "next-intl";
import {
  CAPTION_ALIGNS,
  EDITOR_PRESETS,
  FRAME_STYLES,
  hasCaptionBand,
  ORIGINAL_CAPTION_FONT,
  QR_INKS,
  type EditorDesign,
  type EditorPreset,
} from "@/entities/qr";
import { Button } from "@/shared/ui/button";
import { Swatch } from "@/shared/ui/swatch";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { CaptionField } from "./caption-field";
import { CaptionSizeField } from "./caption-size-field";
import { ColorField } from "./design-panel";
import { OptionGrid } from "./option-grid";

export function FramePanel({
  design,
  onChange,
  onValidity,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  /** Caption text over the limit stops Export at the field, like colour and size fields. */
  onValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor");
  // A layout with text starts with a sample caption, so choosing it shows something; clearing the field hides it.
  const choosePreset = (preset: EditorPreset) =>
    onChange(preset !== "qr" && !design.caption.trim() ? { preset, caption: t("captionPlaceholder") } : { preset });
  return (
    <div className="flex flex-col gap-6">
      <OptionGrid
        label={t("layout")}
        value={design.preset}
        options={EDITOR_PRESETS}
        columns="grid-cols-2 @[26rem]/panel:grid-cols-3"
        onChange={choosePreset}
        render={(o) => t(`presets.${o}`)}
      />
      {design.preset === "frame" ? (
        <OptionGrid
          label={t("frameStyle")}
          value={design.frameStyle}
          options={FRAME_STYLES}
          onChange={(frameStyle) => onChange({ frameStyle })}
          render={(o) => t(`frames.${o}`)}
        />
      ) : null}
      {hasCaptionBand(design.preset) ? (
        <CaptionField
          id="caption"
          label={t("captionField.label")}
          value={design.caption}
          onAccept={(caption) => onChange({ caption })}
          onValidity={onValidity}
        />
      ) : null}
      {design.preset !== "qr" ? <CaptionFontPicker design={design} onChange={onChange} /> : null}
      {/* The frame label sizes itself to the frame (design "Frame text"); the caption layout has a Size field. */}
      {hasCaptionBand(design.preset) ? <CaptionSizeField design={design} onChange={onChange} onValidity={onValidity} /> : null}
      {hasCaptionBand(design.preset) ? <CaptionStyle design={design} onChange={onChange} onValidity={onValidity} /> : null}
      {design.preset === "frame" ? (
        // The frame label has its own rules (design "Frame text"); unchanged here.
        <Field id="caption" label={t("caption")}>
          <Input
            id="caption"
            value={design.caption}
            maxLength={40}
            placeholder={t("captionPlaceholder")}
            onChange={(e) => onChange({ caption: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

/*
 * Design "Caption → Font / Weight" (HEY-44): the caption fonts, each shown in its own face, and the weights that
 * font ships. Changing the font keeps the weight when the new font has it, otherwise the nearest one it ships.
 */
function CaptionFontPicker({ design, onChange }: { design: EditorDesign; onChange: (patch: Partial<EditorDesign>) => void }) {
  const t = useTranslations("editor.captionFont");
  const font = design.captionFont ?? DEFAULT_CAPTION_FONT;
  const original = font === ORIGINAL_CAPTION_FONT;
  const chosenWeight = design.captionWeight ?? DEFAULT_CAPTION_WEIGHT;
  // The original DM Sans of a layout saved before caption fonts ships 400 and 700 only (HEY-45).
  const weightFor = (f: typeof font, w: number) => (f === ORIGINAL_CAPTION_FONT ? (w >= 600 ? 700 : 400) : captionWeightFor(f, w));
  const weight = weightFor(font, chosenWeight);
  const weights = (original ? [400, 700] : supportedWeights(font)).map(String);
  const options: readonly (typeof font)[] = original ? [ORIGINAL_CAPTION_FONT, ...CAPTION_FONT_IDS] : CAPTION_FONT_IDS;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <OptionGrid
          label={t("title")}
          value={font}
          options={options}
          columns="grid-cols-2 @[26rem]/panel:grid-cols-3"
          onChange={(captionFont) => onChange({ captionFont, captionWeight: weightFor(captionFont, weight) as 400 | 500 | 700 })}
          render={(id) =>
            id === ORIGINAL_CAPTION_FONT ? (
              <span className="text-[0.9375rem]" style={{ fontFamily: "DM Sans, sans-serif" }}>
                {t("original")}
              </span>
            ) : (
              <span className="text-[0.9375rem]" style={{ fontFamily: captionFontFamily(CAPTION_FONTS[id]) }}>
                {CAPTION_FONTS[id].label}
              </span>
            )
          }
        />
        <p className="text-caption text-muted-foreground">{t(original ? "originalHint" : "hint")}</p>
      </div>
      <OptionGrid
        label={t("weight")}
        value={String(weight)}
        options={weights}
        columns="grid-cols-3"
        onChange={(w) => onChange({ captionWeight: weightFor(font, Number(w)) as 400 | 500 | 700 })}
        render={(w) => <span style={{ fontWeight: Number(w) }}>{t(`weights.${w as "400" | "500" | "700"}`)}</span>}
      />
    </div>
  );
}

/*
 * Design "Caption → Align" and "Caption color" (HEY-46), for the caption layout. Each line is aligned within the caption
 * band; the colour is the caption's own, using the same HEX field and checks as the code colours plus the QR inks.
 * "Match code" (unset) follows the module colour, as every caption did before. The frame label keeps its own styling.
 */
function CaptionStyle({
  design,
  onChange,
  onValidity,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  onValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor.captionStyle");
  const tInks = useTranslations("home.tool.inks");
  const color = design.captionColor ?? design.fg;
  return (
    <div className="flex flex-col gap-4">
      <OptionGrid
        label={t("align")}
        value={design.captionAlign ?? "center"}
        options={CAPTION_ALIGNS}
        columns="grid-cols-3"
        onChange={(captionAlign) => onChange({ captionAlign })}
        render={(a) => t(`aligns.${a}`)}
      />
      <div className="flex flex-col gap-2">
        <ColorField
          id="caption-color"
          label={t("color")}
          value={color}
          onChange={(captionColor) => onChange({ captionColor })}
          onValidity={onValidity}
        />
        <div role="group" aria-label={t("palette")} className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={design.captionColor === undefined ? "secondary" : "ghost"}
            aria-pressed={design.captionColor === undefined}
            onClick={() => onChange({ captionColor: undefined })}
          >
            {t("matchCode")}
          </Button>
          {QR_INKS.map((ink) => (
            <Swatch
              key={ink.hex}
              color={ink.hex}
              selected={design.captionColor?.toUpperCase() === ink.hex}
              aria-label={tInks(ink.name)}
              onClick={() => onChange({ captionColor: ink.hex })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
