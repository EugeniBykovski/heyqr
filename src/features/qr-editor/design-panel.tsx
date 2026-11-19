"use client";

import { parseHexColor } from "@heyqr/qr-core";
import { CircleAlertIcon, ImagePlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  CENTER_ICONS,
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
import { OptionGrid } from "./option-grid";

const MAX_INLINE_LOGO = 512 * 1024;

/**
 * One colour: a native picker plus a HEX text field (HEY-34). The text being edited is kept apart from the last valid
 * colour: only a valid "#RRGGBB" (either case) reaches the design, so the preview, draft and export never see partial or
 * invalid text. The error shows after blur (or when Export is attempted) and clears as soon as the text is valid.
 */
function ColorField({
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
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  /** Show every invalid colour field's error now (an Export was attempted). */
  showColorErrors?: boolean;
  /** Reports whether a colour field's text is a valid colour, so Export can stop before using the previous colour. */
  onColorValidity?: (id: string, valid: boolean) => void;
}) {
  const t = useTranslations("editor");
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
          <label
            className={cn(
              "relative grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-input bg-surface focus-within:outline-2 focus-within:outline-ring hover:border-input-hover",
              design.logo.kind === "image" && "border-solid border-selected-border bg-selected",
            )}
          >
            <ImagePlusIcon aria-hidden className="size-5" />
            <span className="sr-only">{t("logoUpload")}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file || file.size > MAX_INLINE_LOGO) return;
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === "string" && onChange({ logo: { kind: "image", href: reader.result } });
                reader.readAsDataURL(file);
              }}
            />
          </label>
        </div>
        {design.logo.kind !== "none" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="logo-size">{t("logoSize")}</Label>
            <input
              id="logo-size"
              type="range"
              min={0.12}
              max={0.36}
              step={0.01}
              value={design.logoSize}
              onChange={(e) => onChange({ logoSize: Number(e.target.value) })}
              className="h-11 w-full accent-primary"
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
