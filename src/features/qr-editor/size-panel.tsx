"use client";

import { layoutGeometry, pngPixelSize } from "@heyqr/qr-core";
import { CircleAlertIcon, RulerIcon, ScanLineIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  convertCaptionSize,
  convertSize,
  designToLayout,
  LEGACY_SIZE,
  MM_PRESETS,
  parseSizeValue,
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
import { useFieldValidity } from "./use-field-validity";

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
  hideLabel,
}: {
  id: string;
  label: string;
  /** The field's label is shown elsewhere (QR code size row); kept for screen readers. */
  hideLabel?: boolean;
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
  useFieldValidity(id, valid, onValidity);
  const [min, max] = sizeLimits(unit, field);

  const edit = (next: string) => {
    setText(next);
    const parsed = parseSizeValue(next, unit, field);
    if (parsed !== null) {
      if (parsed !== value) onChange(parsed);
      setTouched(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
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
          className="rounded-r-none text-right tabular-nums"
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

const isCard = (preset: EditorDesign["preset"]) => preset === "vertical" || preset === "horizontal";

/**
 * Design 1.8 Size: units, the code size (the outer square including its quiet zone) with a slider and a number, the
 * layout canvas (QR + caption and the cards have their own; QR only and Frame follow the code), presets, and the export
 * size. The code size and the canvas are independent: changing one never changes the other. A code that no longer fits
 * its canvas is drawn at the largest size that fits (the layout's fit rule) and the panel says so; the quiet zone stays.
 * Every value goes through the design's own size rules (designToLayout, layoutGeometry, pngPixelSize).
 */
export function SizePanel({
  design,
  onChange,
  showErrors,
  onValidity,
  modules,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  showErrors?: boolean;
  onValidity?: (id: string, valid: boolean) => void;
  /** Modules per side of the current code (from the scan check), for the scan distance note. */
  modules?: number;
}) {
  const t = useTranslations("editor.size");
  const size = design.size ?? LEGACY_SIZE;
  const card = isCard(design.preset);
  const ownCanvas = design.preset === "caption" || card;
  const layout = designToLayout(design);
  const g = layoutGeometry(layout);
  // The canvas as entered: the size's own for QR + caption; the card's (or its current proportions) for cards.
  const canvas =
    design.preset === "caption"
      ? { width: size.width, height: size.height }
      : { width: roundTo(g.width, size.unit), height: roundTo(g.height, size.unit) };
  const setCanvas = (patch: Partial<{ width: number; height: number }>) =>
    card ? onChange({ cardSize: { ...canvas, ...patch } }) : onChange({ size: { ...size, ...patch } });
  // The code size alone: a card's canvas is pinned first, so it doesn't follow the code any more.
  const setQr = (qr: number) => onChange(card ? { size: { ...size, qr }, cardSize: design.cardSize ?? canvas } : { size: { ...size, qr } });
  const [qrMin, qrMax] = SIZE_LIMITS[size.unit].qr;
  const shownQr = roundTo(g.qr[2], size.unit);
  const clamped = ownCanvas && g.qr[2] + 1e-9 < size.qr;
  // The default PNG (2× or 300 dpi), sized by the same rule as the export (HEY-37).
  const png = pngPixelSize(layout);
  // Design: "Scans from up to about N cm away (10 : 1 rule)": ten times the symbol's width (the code without its
  // 4-module quiet zone on each side), print layouts only.
  const symbolMm = size.unit === "mm" && modules ? (g.qr[2] * modules) / (modules + 8) : null;

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
            const patch: Partial<EditorDesign> = { size: next };
            // A card's own canvas keeps its physical proportions in the new unit, like the code size.
            if (design.cardSize) {
              const c = convertSize({ unit: size.unit, qr: size.qr, width: design.cardSize.width, height: design.cardSize.height }, unit);
              patch.cardSize = { width: c.width, height: c.height };
            }
            // A chosen caption size keeps its share of the code in the new unit (HEY-45).
            if (design.captionSize !== undefined) patch.captionSize = convertCaptionSize(design.captionSize, size, next);
            onChange(patch);
          }}
        />
        <p className="text-caption text-muted-foreground">{t(size.unit === "mm" ? "unitHintMm" : "unitHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="size-qr">{t("qr")}</Label>
          <span className="text-caption text-muted-foreground">{t("qrHint")}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label={t("qrSlider")}
            min={qrMin}
            max={qrMax}
            step={SIZE_LIMITS[size.unit].step}
            value={Math.min(qrMax, Math.max(qrMin, size.qr))}
            onChange={(e) => setQr(Number(e.target.value))}
            className="h-11 min-w-0 grow touch-pan-y accent-primary"
          />
          <div className="w-32 shrink-0">
            <SizeField
              id="size-qr"
              label={t("qr")}
              hideLabel
              field="qr"
              value={size.qr}
              unit={size.unit}
              forceError={showErrors}
              onValidity={onValidity}
              onChange={setQr}
            />
          </div>
        </div>
        {clamped ? (
          <p role="status" className="flex items-start gap-1.5 text-caption font-medium text-warning">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("clamped", { shown: shownQr, unit: size.unit })}
          </p>
        ) : null}
        {symbolMm !== null ? (
          <p className="flex items-start gap-2 rounded-md bg-accent px-3 py-2.5 text-caption text-accent-foreground">
            <ScanLineIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("reach", { cm: Math.max(1, Math.round(symbolMm)) })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label">{t("layout")}</span>
        <div className="grid grid-cols-2 gap-3">
          <SizeField
            id="size-width"
            label={t("width")}
            field="width"
            value={canvas.width}
            unit={size.unit}
            disabled={!ownCanvas}
            forceError={showErrors}
            onValidity={onValidity}
            onChange={(width) => setCanvas({ width })}
          />
          <SizeField
            id="size-height"
            label={t("height")}
            field="height"
            value={canvas.height}
            unit={size.unit}
            disabled={!ownCanvas}
            forceError={showErrors}
            onValidity={onValidity}
            onChange={(height) => setCanvas({ height })}
          />
        </div>
        {ownCanvas ? (
          <div className="flex flex-wrap gap-2">
            {(size.unit === "mm" ? MM_PRESETS : PX_PRESETS).map((p) => (
              <Button key={p.key} type="button" size="sm" onClick={() => setCanvas({ width: p.width, height: p.height })}>
                {t(`presets.${p.key}`)}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">{t("locked")}</p>
        )}
      </div>

      <p className="flex items-start gap-2.5 rounded-md bg-subtle px-3.5 py-3 text-caption text-secondary-foreground">
        <RulerIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          {t.rich(size.unit === "mm" ? "viewNoteMm" : "viewNotePx", {
            b: (c) => <b className="text-foreground">{c}</b>,
            width: png.width,
            height: png.height,
          })}
        </span>
      </p>
    </div>
  );
}
