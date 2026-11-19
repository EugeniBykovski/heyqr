"use client";

import { PNG_DEFAULTS, PNG_DPIS, PNG_MAX_SIDE, PNG_SCALES, pngPixelSize, type Layout } from "@heyqr/qr-core";
import { DownloadIcon, LoaderCircleIcon, LockIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { startCheckout } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Segmented } from "@/shared/ui/segmented";

type Format = "png" | "svg";

export function ExportPanel({
  qrCodeId,
  layoutId,
  layout,
  model,
  entitled,
  checkout,
  price,
}: {
  qrCodeId: string;
  layoutId: string;
  /** The variant being exported: decides px (scale) or mm (DPI) resolutions and the PNG's pixel size. */
  layout: Layout;
  model: "static" | "dynamic";
  entitled: boolean;
  checkout?: "success" | "cancelled";
  price: { cents: number; currency: string };
}) {
  const t = useTranslations("export");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Format>("png");
  const [pending, startTransition] = useTransition();
  const amount = format.number(price.cents / 100, { style: "currency", currency: price.currency });

  // HEY-37: PNG resolution (design: 1×–8× for screen layouts, 300–1200 dpi for print). Only sizes within the export
  // limits are offered; the label shows the exact PNG size the download will have.
  const print = layout.unit === "mm";
  const choices = (print ? PNG_DPIS : PNG_SCALES).filter((v) => pngPixelSize(layout, print ? { dpi: v } : { scale: v }).ok);
  const fallback = print ? PNG_DEFAULTS.dpi : PNG_DEFAULTS.scale;
  const [resolution, setResolution] = useState<number>(
    (choices as readonly number[]).includes(fallback) ? fallback : (choices[0] ?? fallback),
  );
  const query = print ? `dpi=${resolution}` : `scale=${resolution}`;
  const pixels = pngPixelSize(layout, print ? { dpi: resolution } : { scale: resolution });

  const pay = () =>
    startTransition(async () => {
      const result = await startCheckout({ qrCodeId, layoutId, format: selected, locale });
      if (result.ok) window.location.assign(result.data.url);
      else toast.error(tErrors(result.error === "unauthorized" ? "unauthorized" : "generic"));
    });

  return (
    <div className="flex flex-col gap-5">
      {checkout === "cancelled" ? <p className="rounded-lg bg-subtle px-4 py-3 text-body">{t("cancelled")}</p> : null}
      {checkout === "success" && entitled ? (
        <p className="rounded-lg bg-success-soft px-4 py-3 text-body text-success">{t("paid")}</p>
      ) : null}
      {checkout === "success" && !entitled ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-info-soft px-4 py-3 text-body text-info">
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          {t("pending")}
          <Button variant="link" size="sm" onClick={() => router.refresh()}>
            ↻
          </Button>
        </p>
      ) : null}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-label">{t("format")}</legend>
        {(["png", "svg"] as const).map((f) => (
          <label
            key={f}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-surface p-4 focus-within:outline-2 focus-within:outline-ring has-checked:border-violet-500 has-checked:bg-accent",
            )}
          >
            <input type="radio" name="format" value={f} checked={selected === f} onChange={() => setSelected(f)} className="sr-only" />
            <span className="text-h3">{t(f)}</span>
            <span className="text-caption text-muted-foreground">{t(`${f}Hint`)}</span>
          </label>
        ))}
      </fieldset>

      {selected === "png" ? (
        <div className="flex flex-col gap-2">
          <span className="text-label">{t("resolution")}</span>
          <Segmented
            label={t("resolution")}
            value={String(resolution)}
            options={choices.map((v) => ({ value: String(v), label: print ? t("dpi", { dpi: v }) : t("scale", { scale: v }) }))}
            onChange={(v) => setResolution(Number(v))}
          />
          <span className="text-caption text-muted-foreground tabular-nums">
            {t("pixels", { width: pixels.width, height: pixels.height })}
            {choices.length < (print ? PNG_DPIS : PNG_SCALES).length ? ` · ${t("limit", { max: PNG_MAX_SIDE })}` : ""}
          </span>
        </div>
      ) : null}

      {entitled ? (
        <Button asChild variant="primary" size="lg">
          <a href={`/api/export/${layoutId}?format=${selected}${selected === "png" ? `&${query}` : ""}`} download>
            <DownloadIcon aria-hidden />
            {t("download", { format: selected.toUpperCase() })}
          </a>
        </Button>
      ) : (
        <Button variant="primary" size="lg" disabled={pending} onClick={pay}>
          {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <LockIcon aria-hidden />}
          {model === "dynamic" ? t("subscribe", { price: amount }) : t("pay", { price: amount })}
        </Button>
      )}
      <p className="text-center text-caption text-muted-foreground">{t("secure")}</p>
    </div>
  );
}
