"use client";

import { layoutGeometry } from "@heyqr/qr-core";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  designToLayout,
  LEGACY_SIZE,
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
          inputMode="numeric"
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
          {t("invalid", { min, max, unit })}
        </p>
      ) : null}
    </div>
  );
}

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

  return (
    <div className="flex flex-col gap-5">
      <p className="text-caption text-muted-foreground">{t("unitHint")}</p>

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
          <p className="text-caption text-secondary-foreground">{t("clamped", { shown: Math.round(g.qr[2]), unit: size.unit })}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label">{t("layout")}</span>
        <div className="grid grid-cols-2 gap-3">
          <SizeField
            id="size-width"
            label={t("width")}
            field="width"
            value={ownCanvas ? size.width : Math.round(g.width)}
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
            value={ownCanvas ? size.height : Math.round(g.height)}
            unit={size.unit}
            disabled={!ownCanvas}
            forceError={showErrors}
            onValidity={onValidity}
            onChange={(height) => set({ height })}
          />
        </div>
        {ownCanvas ? (
          <div className="flex flex-wrap gap-2">
            {PX_PRESETS.map((p) => (
              <Button key={p.key} type="button" size="sm" onClick={() => onChange({ size: presetSize(p.width, p.height) })}>
                {t(`presets.${p.key}`)}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">{t("locked")}</p>
        )}
      </div>

      <p className="rounded-md bg-subtle px-3.5 py-3 text-caption text-secondary-foreground">
        {t("export", { width: Math.round(g.width * 2), height: Math.round(g.height * 2), unit: size.unit })}
      </p>
    </div>
  );
}
