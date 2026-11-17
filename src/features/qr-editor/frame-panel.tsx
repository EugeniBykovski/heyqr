"use client";

import { useTranslations } from "next-intl";
import { EDITOR_PRESETS, FRAME_STYLES, type EditorDesign } from "@/entities/qr";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { OptionGrid } from "./option-grid";

export function FramePanel({ design, onChange }: { design: EditorDesign; onChange: (patch: Partial<EditorDesign>) => void }) {
  const t = useTranslations("editor");
  return (
    <div className="flex flex-col gap-6">
      <OptionGrid
        label={t("layout")}
        value={design.preset}
        options={EDITOR_PRESETS}
        columns="grid-cols-3"
        onChange={(preset) => onChange({ preset })}
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
      {design.preset !== "qr" ? (
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
