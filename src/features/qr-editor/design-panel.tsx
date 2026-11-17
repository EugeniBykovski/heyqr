"use client";

import { ImagePlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { CENTER_ICONS, EYE_BALL_SHAPES, EYE_FRAME_SHAPES, MODULE_SHAPES, type CenterIcon, type EditorDesign } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { OptionGrid } from "./option-grid";

const MAX_INLINE_LOGO = 512 * 1024;

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-11 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1"
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="font-mono uppercase"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export function DesignPanel({ design, onChange }: { design: EditorDesign; onChange: (patch: Partial<EditorDesign>) => void }) {
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
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-label">{t("colors")}</legend>
        <ColorField id="color-fg" label={t("fg")} value={design.fg} onChange={(fg) => onChange({ fg })} />
        <ColorField id="color-bg" label={t("bg")} value={design.bg} onChange={(bg) => onChange({ bg })} />
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
