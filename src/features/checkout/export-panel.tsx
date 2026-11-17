"use client";

import { DownloadIcon, LoaderCircleIcon, LockIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { startCheckout } from "@/server/actions/qr";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

type Format = "png" | "svg";

export function ExportPanel({
  qrCodeId,
  layoutId,
  model,
  entitled,
  checkout,
  price,
}: {
  qrCodeId: string;
  layoutId: string;
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

      {entitled ? (
        <Button asChild variant="primary" size="lg">
          <a href={`/api/export/${layoutId}?format=${selected}`} download>
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
