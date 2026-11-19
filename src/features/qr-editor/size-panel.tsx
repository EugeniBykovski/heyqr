"use client";

import { layoutGeometry, pngPixelSize } from "@heyqr/qr-core";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  convertCaptionSize,
  convertSize,
  designToLayout,
  LEGACY_SIZE,
  MM_PRESETS,
  parseSizeValue,
  presetSize,
  PX_PRESETS,
  SIZE_LIMITS,
  sizeLimits,
  type DesignSize,
  type EditorDesign,
  type SizeField,
} from "@/entities/qr";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Segmented } from "@/shared/ui/segmented";

/**
 * One size value (HEY-35). Like the colour fields (HEY-34), the text being typed is separate from the last valid
 * value: only a valid size reaches the design, preview and export; the error shows on blur or on an export attempt.
 */
function SizeField({
  id,
  label,
  field,
  value,
  unit,
  disabled,
  forceError,
  onChange,
  onValidity,
}: {
  id: string;
  label: string;
  field: SizeField;
  value: number;
  unit: DesignSize["unit"];
  disabled?: boolean;
  forceError?: boolean;
  onChange: (v: number) => void;
  onValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor.size");
  const [text, setText] = useState(String(value));
  const [synced, setSynced] = useState(value);
  const [touched, setTouched] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setText(String(value));
    setTouched(false);
  }
  const valid = disabled || parseSizeValue(text, unit, field) !== null;
  const showError = !valid && (touched || Boolean(forceError));
  useEffect(() => () => onValidity?.(id, true), [id, onValidity]);
  const [min, max] = sizeLimits(unit, field);

  const edit = (next: string) => {
    setText(next);
    const parsed = parseSizeValue(next, unit, field);
    onValidity?.(id, parsed !== null);
    if (parsed !== null) {
      if (parsed !== value) onChange(parsed);
      setTouched(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 items-stretch">
        <Input
          id={id}
          value={text}
          inputMode={unit === "mm" ? "decimal" : "numeric"}
          autoComplete="off"
          disabled={disabled}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => !valid && setTouched(true)}
          className="rounded-r-none font-mono tabular-nums"
        />
        <span className="grid min-w-12 place-items-center rounded-r-md border border-l-0 border-border bg-subtle px-3 text-caption text-muted-foreground">
          {unit}
        </span>
      </div>
      {showError ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t(unit === "mm" ? "invalidMm" : "invalid", { min, max, unit })}
        </p>
      ) : null}
    </div>
  );
}

/** Locked (derived) dimensions shown at the unit's precision: whole px, 0.1 mm. */
const roundTo = (v: number, unit: DesignSize["unit"]) => (unit === "mm" ? Math.round(v * 10) / 10 : Math.round(v));

/** Design 1.8 Size: code size (with quiet zone), layout canvas (when the layout has its own), presets, export size. */
export function SizePanel({
  design,
  onChange,
  showErrors,
  onValidity,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  showErrors?: boolean;
  onValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor.size");
  const size = design.size ?? LEGACY_SIZE;
  const ownCanvas = design.preset === "caption";
  const set = (patch: Partial<DesignSize>) => onChange({ size: { ...size, ...patch } });
  const g = layoutGeometry(designToLayout(design));
  const [qrMin, qrMax] = SIZE_LIMITS[size.unit].qr;
  const clamped = ownCanvas && g.qr[2] < size.qr;
  // The default PNG (2× or 300 dpi), sized by the same rule as the export (HEY-37).
  const png = pngPixelSize(designToLayout(design));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span id="size-units" className="text-label">
          {t("units")}
        </span>
        <Segmented
          label={t("units")}
          value={size.unit}
          options={[
            { value: "mm", label: t("unitMm") },
            { value: "px", label: t("unitPx") },
          ]}
          onChange={(unit) => {
            const next = convertSize(size, unit);
            // A chosen caption size keeps its share of the code in the new unit (HEY-45).
            onChange(
              design.captionSize === undefined
                ? { size: next }
                : { size: next, captionSize: convertCaptionSize(design.captionSize, size, next) },
            );
          }}
        />
        <p className="text-caption text-muted-foreground">{t(size.unit === "mm" ? "unitHintMm" : "unitHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <SizeField
          id="size-qr"
          label={t("qr")}
          field="qr"
          value={size.qr}
          unit={size.unit}
          forceError={showErrors}
          onValidity={onValidity}
          onChange={(qr) => set({ qr })}
        />
        <input
          type="range"
          aria-label={t("qrSlider")}
          min={qrMin}
          max={qrMax}
          step={SIZE_LIMITS[size.unit].step}
          value={size.qr}
          onChange={(e) => set({ qr: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <span className="text-caption text-muted-foreground">{t("qrNote")}</span>
        {clamped ? (
          <p className="text-caption text-secondary-foreground">{t("clamped", { shown: roundTo(g.qr[2], size.unit), unit: size.unit })}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label">{t("layout")}</span>
        <div className="grid grid-cols-2 gap-3">
          <SizeField
            id="size-width"
            label={t("width")}
            field="width"
            value={ownCanvas ? size.width : roundTo(g.width, size.unit)}
            unit={size.unit}
            disabled={!ownCanvas}
            forceError={showErrors}
            onValidity={onValidity}
            onChange={(width) => set({ width })}
          />
          <SizeField
            id="size-height"
            label={t("height")}
            field="height"
            value={ownCanvas ? size.height : roundTo(g.height, size.unit)}
            unit={size.unit}
            disabled={!ownCanvas}
            forceError={showErrors}
            onValidity={onValidity}
            onChange={(height) => set({ height })}
          />
        </div>
        {ownCanvas ? (
          <div className="flex flex-wrap gap-2">
            {(size.unit === "mm" ? MM_PRESETS : PX_PRESETS).map((p) => (
              <Button key={p.key} type="button" size="sm" onClick={() => onChange({ size: presetSize(p.width, p.height, size.unit) })}>
                {t(`presets.${p.key}`)}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">{t("locked")}</p>
        )}
      </div>

      <p className="rounded-md bg-subtle px-3.5 py-3 text-caption text-secondary-foreground">
        {size.unit === "mm"
          ? t("exportMm", {
              width: Math.round(g.width * 10) / 10,
              height: Math.round(g.height * 10) / 10,
              pxWidth: png.width,
              pxHeight: png.height,
            })
          : t("export", { width: png.width, height: png.height, unit: size.unit })}
      </p>
    </div>
  );
}
