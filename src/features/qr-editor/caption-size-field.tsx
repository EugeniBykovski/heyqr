"use client";

import { captionFontSize, layoutGeometry } from "@heyqr/qr-core";
import { CircleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  CAPTION_SIZE_LIMITS,
  captionSizeUnit,
  defaultCaptionSize,
  designToLayout,
  LEGACY_SIZE,
  MM_PER_PT,
  parseCaptionSize,
  type EditorDesign,
} from "@/entities/qr";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const round1 = (v: number) => Math.round(v * 10) / 10;

/*
 * Design "Caption → Size" (HEY-45): px for screen layouts, pt for print ones, 4–400 px / 4–120 pt. A value outside the
 * rule is shown as typed with an error, and the layout keeps its last valid size (and Export stops at the field).
 * When the caption doesn't fit its band at that size, the renderer shrinks it, the same way in preview, SVG and PNG;
 * the field says so.
 */
export function CaptionSizeField({
  design,
  onChange,
  onValidity,
  forceError,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  onValidity?: (id: string, valid: boolean) => void;
  forceError?: boolean;
}) {
  const t = useTranslations("editor.captionSize");
  const format = useFormatter();
  const size = design.size ?? LEGACY_SIZE;
  const unit = captionSizeUnit(size.unit);
  const value = round1(design.captionSize ?? defaultCaptionSize(size));
  const [text, setText] = useState(String(value));
  const [synced, setSynced] = useState(value);
  const [touched, setTouched] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setText(String(value));
    setTouched(false);
  }
  const valid = parseCaptionSize(text, unit) !== null;
  const showError = !valid && (touched || Boolean(forceError) || text.trim() !== "");
  useEffect(() => () => onValidity?.("caption-size", true), [onValidity]);
  const [min, max] = CAPTION_SIZE_LIMITS[unit];

  const edit = (next: string) => {
    setText(next);
    const parsed = parseCaptionSize(next, unit);
    onValidity?.("caption-size", parsed !== null);
    if (parsed !== null && parsed !== value) {
      setSynced(parsed);
      onChange({ captionSize: parsed });
    }
  };

  // What the renderer actually draws the first line at, in the field's unit.
  const layout = designToLayout(design);
  const drawn = captionFontSize(layout, layoutGeometry(layout));
  const drawnInUnit = unit === "px" ? drawn : drawn / MM_PER_PT;
  const shrunk = valid && layout.caption.text && drawnInUnit < value - 0.05;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="caption-size">{t("label")}</Label>
      <div className="flex min-w-0 items-stretch">
        <Input
          id="caption-size"
          value={text}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={showError || undefined}
          aria-describedby={showError ? "caption-size-error" : shrunk ? "caption-size-fit" : undefined}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => !valid && setTouched(true)}
          className="rounded-r-none font-mono tabular-nums"
        />
        <span className="grid min-w-12 place-items-center rounded-r-md border border-l-0 border-border bg-subtle px-3 text-caption text-muted-foreground">
          {unit}
        </span>
      </div>
      {showError ? (
        <p id="caption-size-error" role="alert" className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t("invalid", { min, max, unit })}
        </p>
      ) : shrunk ? (
        <p id="caption-size-fit" className="text-caption text-muted-foreground">
          {t("fitted", { size: format.number(round1(drawnInUnit)), unit })}
        </p>
      ) : null}
    </div>
  );
}
