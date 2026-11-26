"use client";

import { contrastRatio } from "@heyqr/qr-core";
import { CheckIcon, ImageIcon, InfoIcon, RotateCcwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent } from "react";
import {
  BRAND_LOOKS,
  brandColorPatch,
  brandColorsOf,
  brandLookPatch,
  brandRoles,
  designToLayout,
  extractPalette,
  LOGO_ACCEPT,
  QrPreview,
  SAMPLE_LOGO,
  type BrandLook,
  type BrandRole,
  type EditorDesign,
} from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Swatch } from "@/shared/ui/swatch";
import { ColorField } from "./design-panel";
import { intakeLogo } from "./logo-intake";

const SAMPLE_NAME = "little-fern-coffee.svg";

/** Reads an image's pixels in the browser and returns its palette (design 2.6 "Reading colors from your image"). */
export async function readImagePalette(href: string): Promise<string[]> {
  const img = new Image();
  img.decoding = "async";
  img.src = href;
  await img.decode();
  const side = 64;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const scale = Math.min(side / (img.naturalWidth || side), side / (img.naturalHeight || side));
  const w = Math.max(1, Math.round((img.naturalWidth || side) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || side) * scale));
  ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
  return extractPalette(ctx.getImageData(0, 0, side, side).data);
}

type Status = "empty" | "reading" | "ready" | "error";

/*
 * Design 2.5–2.9 Branded: 1 · the logo or image (drop zone on desktop, photos or files on phones, a sample), 2 · its
 * colours as three editable roles with a contrast note, 3 · three looks of the same code, 4 · fine-tune links.
 * Reading an image never blocks editing: the last ready design stays on the canvas, and a result that arrives after a
 * newer file (or removal) is dropped.
 */
export function BrandGroup({
  design,
  onChange,
  onBusy,
  onGoTo,
  onFieldValidity,
  value,
}: {
  design: EditorDesign;
  onChange: (patch: Partial<EditorDesign>) => void;
  /** Reading an image: the canvas shows this status over the last ready design. */
  onBusy: (busy: boolean) => void;
  onGoTo: (group: "logo" | "pattern" | "caption" | "size") => void;
  onFieldValidity?: (id: string, valid: boolean) => void;
  value: string;
}) {
  const t = useTranslations("editor.brand");
  const [status, setStatus] = useState<Status>(design.brand && design.logo.kind === "image" ? "ready" : "empty");
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [role, setRole] = useState<BrandRole>("primary");
  const attempt = useRef(0);
  const hasImage = design.logo.kind === "image" && design.brand !== undefined;
  const colors = brandColorsOf(design);
  const palette = design.brand?.palette ?? [];

  const take = async (source: { file: File } | { sample: true }) => {
    const token = ++attempt.current;
    const name = "file" in source ? source.file.name : SAMPLE_NAME;
    setReading(name);
    setStatus("reading");
    onBusy(true);
    try {
      let href = SAMPLE_LOGO;
      if ("file" in source) {
        const intake = await intakeLogo(source.file);
        if (!intake.ok) throw new Error(intake.reason);
        href = intake.href;
      }
      const found = await readImagePalette(href);
      if (token !== attempt.current) return; // a newer file or a removal won
      const roles = brandRoles(found);
      const base: EditorDesign = { ...design, ...brandColorPatch(roles), logo: { kind: "image", href }, brand: { palette: found, name } };
      onChange({
        designMode: "branded",
        logo: { kind: "image", href },
        brand: { palette: found, name },
        ...brandColorPatch(roles),
        ...brandLookPatch(base, design.look ?? "center"),
      });
      setStatus("ready");
    } catch {
      if (token === attempt.current) setStatus("error");
    } finally {
      if (token === attempt.current) {
        setReading(null);
        onBusy(false);
      }
    }
  };

  const remove = () => {
    attempt.current++;
    setReading(null);
    onBusy(false);
    setStatus("empty");
    onChange({ logo: { kind: "none" }, brand: undefined, art: undefined, look: undefined, logoPosition: undefined });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void take({ file });
  };

  const setRoleColor = (r: BrandRole, hex: string) => onChange(brandColorPatch({ ...colors, [r]: hex }));
  const ratio = contrastRatio(colors.primary, colors.bg);
  const tone = ratio >= 4 ? "ok" : ratio >= 3 ? "warn" : "err";

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="brand-step-1" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="brand-step-1" className="text-[0.875rem] font-bold">
            {t("step1")}
          </h3>
          <span className="text-caption text-muted-foreground">{hasImage ? t("step1Ready") : t("step1Hint")}</span>
        </div>
        {status === "reading" ? (
          <div aria-busy className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
            <span className="size-12 shrink-0 animate-pulse rounded-md bg-skeleton motion-reduce:animate-none" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-label">{reading}</span>
              <span role="status" className="text-caption text-muted-foreground">
                {t("reading")}
              </span>
            </span>
          </div>
        ) : hasImage && design.logo.kind === "image" ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
            <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-subtle p-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL preview */}
              <img src={design.logo.href} alt={t("preview")} className="block size-full min-h-0 min-w-0 object-contain" />
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="truncate text-label" title={design.brand?.name}>
                {design.brand?.name ?? t("image")}
              </span>
              <span className="text-caption text-muted-foreground">{t("colorsFound", { count: palette.length })}</span>
            </span>
            <label className="focus-within:outline-focus-ring inline-flex min-h-control-sm cursor-pointer items-center rounded-full border border-border bg-surface px-3.5 text-[0.875rem] font-semibold focus-within:outline-2 hover:border-border-hover">
              {t("replace")}
              <input
                type="file"
                accept={LOGO_ACCEPT}
                className="sr-only"
                aria-label={t("replaceLabel")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void take({ file });
                }}
              />
            </label>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("remove")} onClick={remove}>
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-6 text-center transition-colors duration-(--motion-fast)",
              over && "border-selected-border bg-selected",
              status === "error" && "border-danger",
            )}
          >
            <span className="grid size-11 place-items-center rounded-full bg-subtle">
              <UploadIcon aria-hidden className="size-5 text-muted-foreground" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-label max-sm:hidden">{over ? t("dropNow") : t("drag")}</span>
              <span className="text-label sm:hidden">{t("add")}</span>
              <span className="text-caption text-muted-foreground">{t("formats")}</span>
            </span>
            <div className="flex flex-wrap justify-center gap-2">
              <label className="focus-within:outline-focus-ring inline-flex min-h-control-sm cursor-pointer items-center gap-2 rounded-full bg-primary px-3.5 text-[0.875rem] font-semibold text-primary-foreground focus-within:outline-2 focus-within:outline-offset-2 hover:bg-primary-hover">
                <ImageIcon aria-hidden className="size-4" />
                <span className="max-sm:hidden">{t("choose")}</span>
                <span className="sm:hidden">{t("chooseMobile")}</span>
                <input
                  type="file"
                  accept={LOGO_ACCEPT}
                  className="sr-only"
                  aria-label={t("chooseLabel")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void take({ file });
                  }}
                />
              </label>
              <Button type="button" size="sm" variant="ghost" onClick={() => void take({ sample: true })}>
                {t("sample")}
              </Button>
            </div>
            {status === "error" ? (
              <p role="alert" className="text-caption font-medium text-danger">
                {t("error")}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {hasImage ? (
        <>
          <section aria-labelledby="brand-step-2" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="brand-step-2" className="text-[0.875rem] font-bold">
                {t("step2")}
              </h3>
              <span className="text-caption text-muted-foreground">{t("step2Hint")}</span>
            </div>
            <div role="group" aria-label={t("roles")} className="flex flex-col gap-1.5">
              {(["primary", "bg", "accent"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-2.5 py-1.5 text-start hover:border-border-hover aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]"
                >
                  <span
                    aria-hidden
                    className="size-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(13_13_18/0.16)]"
                    style={{ backgroundColor: colors[r] }}
                  />
                  <span className="flex min-w-0 grow flex-col">
                    <span className="text-[0.875rem] font-semibold">{t(`role.${r}`)}</span>
                    <span className="text-caption text-muted-foreground">{t(`roleHint.${r}`)}</span>
                  </span>
                  <span className="font-mono text-[0.8125rem] text-secondary-foreground">{colors[r].toUpperCase()}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-3">
              <span className="text-label">{t("fromImage")}</span>
              <div role="group" aria-label={t("found")} className="flex flex-wrap gap-2">
                {palette.map((c) => (
                  <Swatch
                    key={c}
                    color={c}
                    selected={colors[role].toUpperCase() === c.toUpperCase()}
                    aria-label={c}
                    title={c}
                    onClick={() => setRoleColor(role, c)}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-36 grow">
                  <ColorField
                    key={role}
                    id={`brand-${role}`}
                    label={t("hexFor", { role: t(`role.${role}`) })}
                    value={colors[role]}
                    onChange={(hex) => setRoleColor(role, hex)}
                    onValidity={onFieldValidity}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mb-1"
                  onClick={() => setRoleColor(role, brandRoles(palette)[role])}
                >
                  <RotateCcwIcon aria-hidden />
                  {t("reset")}
                </Button>
              </div>
            </div>
            <p
              role="status"
              className={cn(
                "flex items-start gap-2 rounded-md px-3 py-2.5 text-[0.875rem]",
                tone === "ok" && "bg-success-soft text-success",
                tone === "warn" && "bg-warning-soft text-warning",
                tone === "err" && "bg-danger-soft text-danger",
              )}
            >
              <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t(`contrast.${tone}`, { ratio: ratio.toFixed(1) })}
            </p>
            <p className="text-caption text-muted-foreground">{t("appColors")}</p>
          </section>

          <section aria-labelledby="brand-step-3" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="brand-step-3" className="text-[0.875rem] font-bold">
                {t("step3")}
              </h3>
              <span className="text-caption text-muted-foreground">{t("step3Hint")}</span>
            </div>
            {/* Design 2.7: the three looks side by side at every width (phones included), the chosen one with a check. */}
            <div role="group" aria-label={t("looks")} className="grid grid-cols-3 gap-2">
              {BRAND_LOOKS.map((look) => (
                <LookCard
                  key={look}
                  look={look}
                  design={design}
                  value={value}
                  selected={(design.look ?? "center") === look}
                  onPick={() => onChange(brandLookPatch(design, look))}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="brand-step-4" className="flex flex-col gap-2">
            <h3 id="brand-step-4" className="text-[0.875rem] font-bold">
              {t("step4")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {(["logo", "pattern", "caption", "size"] as const).map((g) => (
                <Button key={g} type="button" size="sm" variant="secondary" onClick={() => onGoTo(g)}>
                  {t(`fine.${g}`)}
                </Button>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function LookCard({
  look,
  design,
  value,
  selected,
  onPick,
}: {
  look: BrandLook;
  design: EditorDesign;
  value: string;
  selected: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("editor.brand.lookCards");
  const layout = designToLayout({ ...design, ...brandLookPatch(design, look) });
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className="group/look relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-border bg-surface p-1.5 text-start hover:border-border-hover aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]"
    >
      <span
        aria-hidden
        className="absolute end-1.5 top-1.5 z-10 hidden size-5 place-items-center rounded-full bg-selected-mark text-inverse-foreground group-aria-pressed/look:grid"
      >
        <CheckIcon strokeWidth={3.2} className="size-3" />
      </span>
      <span className="grid aspect-square place-items-center overflow-hidden rounded-md bg-subtle p-1.5">
        <QrPreview layout={layout} value={value} label="" className="size-full" />
      </span>
      <span className="text-[0.8125rem] leading-tight font-semibold">{t(`${look}.title`)}</span>
      <span className="text-caption text-muted-foreground">{t(`${look}.desc`)}</span>
    </button>
  );
}
