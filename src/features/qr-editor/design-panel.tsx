"use client";

import { CENTER_LOGO_SIZE, centerLogoSize, parseHexColor } from "@heyqr/qr-core";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  CENTER_ICONS,
  defaultLogoPlate,
  LOGO_PLATES,
  DEFAULT_DESIGN,
  EYE_BALL_SHAPES,
  EYE_FRAME_SHAPES,
  MODULE_SHAPES,
  type CenterIcon,
  type EditorDesign,
} from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { LogoFeedback, LogoUploadTile, type LogoFeedbackState } from "./logo-upload";
import { OptionGrid } from "./option-grid";

/**
 * One colour: a native picker plus a HEX text field (HEY-34). The text being edited is kept apart from the last valid
 * colour: only a valid "#RRGGBB" (either case) reaches the design, so the preview, draft and export never see partial or
 * invalid text. The error shows after blur (or when Export is attempted) and clears as soon as the text is valid.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
  forceError,
  onValidity,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  forceError?: boolean;
  onValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor");
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  const [touched, setTouched] = useState(false);
  // The colour changed from outside (picker, Reset colors, inherited module colour): show it.
  if (value !== synced) {
    setSynced(value);
    setText(value);
    setTouched(false);
  }
  const valid = parseHexColor(text) !== null;
  const showError = !valid && (touched || Boolean(forceError));
  // A field that disappears (another step, reset) can't keep Export blocked.
  useEffect(() => () => onValidity?.(id, true), [id, onValidity]);

  const edit = (next: string) => {
    setText(next);
    const parsed = parseHexColor(next);
    onValidity?.(id, parsed !== null);
    if (parsed) {
      if (parsed !== value) onChange(parsed);
      setTouched(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => edit(e.target.value)}
          className="size-11 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1"
        />
        <Input
          id={id}
          value={text}
          maxLength={9}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? `${id}-error` : undefined}
          data-color-invalid={valid ? undefined : "true"}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => {
            const parsed = parseHexColor(text);
            if (parsed) setText(parsed);
            else setTouched(true);
          }}
          className="font-mono uppercase"
        />
      </div>
      {showError ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t("colorInvalid")}
        </p>
      ) : null}
    </div>
  );
}

export function DesignPanel({
  design,
  onChange,
  showColorErrors,
  onColorValidity,
  logoScanMax,
}: {
  /** The largest logo size that still scans for this design (scan check), shown beside the slider. */
  logoScanMax?: number;
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  /** Show every invalid colour field's error now (an Export was attempted). */
  showColorErrors?: boolean;
  /** Reports whether a colour field's text is a valid colour, so Export can stop before using the previous colour. */
  onColorValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor");
  const [logoFeedback, setLogoFeedback] = useState<LogoFeedbackState>(null);
  // Older layouts may hold a size outside the limits; it is drawn within them and only changes when edited.
  const drawnLogoSize = centerLogoSize(design.logoSize);
  const savedOverMax = design.logoSize > CENTER_LOGO_SIZE.max;
  const iconKeys = Object.keys(CENTER_ICONS) as CenterIcon[];
  const logoValue = design.logo.kind === "icon" ? design.logo.icon : design.logo.kind;

  return (
    <div className="flex flex-col gap-6">
      <OptionGrid
        label={t("pattern")}
        value={design.pattern}
        options={MODULE_SHAPES}
        onChange={(pattern) => onChange({ pattern })}
        render={(o) => t(`shapes.${o}`)}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <OptionGrid
          label={t("eyeFrame")}
          value={design.eyeFrame}
          options={EYE_FRAME_SHAPES}
          columns="grid-cols-3"
          onChange={(eyeFrame) => onChange({ eyeFrame })}
          render={(o) => t(`shapes.${o}`)}
        />
        <OptionGrid
          label={t("eyeBall")}
          value={design.eyeBall}
          options={EYE_BALL_SHAPES}
          columns="grid-cols-3"
          onChange={(eyeBall) => onChange({ eyeBall })}
          render={(o) => t(`shapes.${o}`)}
        />
      </div>
      {/* Design "Colors": modules, corner frames, corner centers and background. Corners follow the modules until set. */}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 flex w-full items-center justify-between gap-3 text-label">
          {t("colors")}
          {design.fg !== DEFAULT_DESIGN.fg || design.bg !== DEFAULT_DESIGN.bg || design.eye !== undefined || design.eyeIn !== undefined ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => onChange({ fg: DEFAULT_DESIGN.fg, bg: DEFAULT_DESIGN.bg, eye: undefined, eyeIn: undefined })}
            >
              {t("resetColors")}
            </Button>
          ) : null}
        </legend>
        <ColorField
          forceError={showColorErrors}
          onValidity={onColorValidity}
          id="color-fg"
          label={t("fg")}
          value={design.fg}
          onChange={(fg) => onChange({ fg })}
        />
        <ColorField
          forceError={showColorErrors}
          onValidity={onColorValidity}
          id="color-eye"
          label={t("eyeColor")}
          value={design.eye ?? design.fg}
          onChange={(eye) => onChange({ eye })}
        />
        <ColorField
          forceError={showColorErrors}
          onValidity={onColorValidity}
          id="color-eye-in"
          label={t("eyeInColor")}
          value={design.eyeIn ?? design.fg}
          onChange={(eyeIn) => onChange({ eyeIn })}
        />
        <ColorField
          forceError={showColorErrors}
          onValidity={onColorValidity}
          id="color-bg"
          label={t("bg")}
          value={design.bg}
          onChange={(bg) => onChange({ bg })}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-label">{t("logo")}</legend>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
          {(["none", ...iconKeys] as const).map((key) => {
            const selected = logoValue === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                aria-label={key === "none" ? t("logoNone") : t(`icons.${key}`)}
                onClick={() => onChange({ logo: key === "none" ? { kind: "none" } : { kind: "icon", icon: key } })}
                className={cn(
                  "grid aspect-square cursor-pointer place-items-center rounded-lg border border-border bg-surface transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-hover",
                  "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
                )}
              >
                {key === "none" ? (
                  <span aria-hidden className="text-caption text-muted-foreground">
                    —
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden
                    className="size-5 fill-none stroke-current stroke-2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={CENTER_ICONS[key]} />
                  </svg>
                )}
              </button>
            );
          })}
          <LogoUploadTile
            selected={design.logo.kind === "image"}
            label={t("logoUpload")}
            onLogo={(href) => onChange({ logo: { kind: "image", href } })}
            onFeedback={setLogoFeedback}
          />
        </div>
        <LogoFeedback feedback={logoFeedback} />
        {design.logo.kind !== "none" ? (
          <div className="flex flex-col gap-1.5">
            {/* HEY-52: 10–46 % of the code's width (design handoff); the renderer draws any saved value within it. */}
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="logo-size">{t("logoSize")}</Label>
              <span id="logo-size-value" className="text-caption text-muted-foreground tabular-nums">
                {logoScanMax
                  ? t("logoSizeValue", { size: Math.round(drawnLogoSize * 100), max: Math.round(logoScanMax * 100) })
                  : `${Math.round(drawnLogoSize * 100)}%`}
              </span>
            </div>
            <input
              id="logo-size"
              type="range"
              min={CENTER_LOGO_SIZE.min}
              max={CENTER_LOGO_SIZE.max}
              step={0.01}
              value={drawnLogoSize}
              aria-describedby={`logo-size-value${savedOverMax ? " logo-size-legacy" : ""}`}
              onChange={(e) => onChange({ logoSize: Number(e.target.value) })}
              className="h-11 w-full accent-primary"
            />
            {savedOverMax ? (
              <p id="logo-size-legacy" className="text-caption text-muted-foreground">
                {t("logoSizeLegacy", { saved: Math.round(design.logoSize * 100), max: Math.round(CENTER_LOGO_SIZE.max * 100) })}
              </p>
            ) : null}
          </div>
        ) : null}
        {design.logo.kind !== "none" ? (
          // Design "plate" (HEY-51): the backing behind the logo. Modules under it are always cleared.
          <OptionGrid
            label={t("logoPlate.label")}
            value={design.logoPlate ?? defaultLogoPlate(design.logo)}
            options={LOGO_PLATES}
            columns="grid-cols-3"
            onChange={(logoPlate) => onChange({ logoPlate })}
            render={(o) => t(`logoPlate.${o}`)}
          />
        ) : null}
      </fieldset>
    </div>
  );
}
