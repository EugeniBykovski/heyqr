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
import { EDITOR_PRESETS, FRAME_STYLES, type EditorDesign, type EditorPreset } from "@/entities/qr";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { CaptionField } from "./caption-field";
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
        columns="grid-cols-3"
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
      {design.preset === "caption" ? (
        <CaptionField
          id="caption"
          label={t("captionField.label")}
          value={design.caption}
          onAccept={(caption) => onChange({ caption })}
          onValidity={onValidity}
        />
      ) : null}
      {design.preset !== "qr" ? <CaptionFontPicker design={design} onChange={onChange} /> : null}
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
  const weight = captionWeightFor(font, design.captionWeight ?? DEFAULT_CAPTION_WEIGHT);
  const weights = supportedWeights(font).map(String);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <OptionGrid
          label={t("title")}
          value={font}
          options={CAPTION_FONT_IDS}
          columns="grid-cols-2 @[26rem]/panel:grid-cols-3"
          onChange={(captionFont) => onChange({ captionFont, captionWeight: captionWeightFor(captionFont, weight) })}
          render={(id) => (
            <span className="text-[0.9375rem]" style={{ fontFamily: captionFontFamily(CAPTION_FONTS[id]) }}>
              {CAPTION_FONTS[id].label}
            </span>
          )}
        />
        <p className="text-caption text-muted-foreground">{t("hint")}</p>
      </div>
      <OptionGrid
        label={t("weight")}
        value={String(weight)}
        options={weights}
        columns="grid-cols-3"
        onChange={(w) => onChange({ captionWeight: captionWeightFor(font, Number(w)) })}
        render={(w) => <span style={{ fontWeight: Number(w) }}>{t(`weights.${w as "400" | "500" | "700"}`)}</span>}
      />
    </div>
  );
}
