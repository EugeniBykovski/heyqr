"use client";

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
