"use client";

import type { QrContentType } from "@heyqr/qr-core";
import { CheckIcon, InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { QR_MODES, supportsMode, type QrMode } from "@/entities/qr";
import { formatMoney } from "@/shared/config/catalog";
import { usePrices } from "@/shared/lib/currency";
import { cn } from "@/shared/lib/utils";

/*
 * Design "model" card on the Type step: "Can the link change after printing?" with Static and Dynamic option cards.
 * Modes a type doesn't support stay visible but disabled, with the reason, so the choice is never silently hidden.
 */
export function ModeChoice({ type, value, onChange }: { type: QrContentType; value: QrMode; onChange: (mode: QrMode) => void }) {
  const t = useTranslations("editor.mode");
  const tTypes = useTranslations("contentTypes");
  const prices = usePrices();
  const money = (cents: number | null) => formatMoney(cents, prices.currency);
  const price = { static: money(prices.cents.single), dynamic: money(prices.cents.starter) };
  const dynamicAvailable = supportsMode(type, "dynamic");

  return (
    <section aria-labelledby="mode-question" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-1 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="mode-question" className="text-h3">
          {t("question")}
        </h2>
        <p className="text-caption text-secondary-foreground">{t("lead")}</p>
      </div>
      <div role="group" aria-labelledby="mode-question" className="grid gap-2 @[34rem]/panel:grid-cols-2">
        {QR_MODES.map((mode) => {
          const selected = value === mode;
          const disabled = !supportsMode(type, mode);
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              aria-describedby={disabled ? "mode-unavailable" : undefined}
              onClick={() => onChange(mode)}
              className={cn(
                "relative flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3.5 pr-9 text-left",
                "transition-[border-color,box-shadow,background-color] duration-(--motion-fast) hover:border-border-hover",
                "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border",
              )}
            >
              {selected ? (
                <span className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-selected-mark text-inverse-foreground">
                  <CheckIcon aria-hidden strokeWidth={3.2} className="size-3" />
                </span>
              ) : null}
              <span className="text-caption text-muted-foreground">{t(`${mode}.eyebrow`)}</span>
              <span className="text-h3">{t(`${mode}.title`)}</span>
              <span className="text-caption text-secondary-foreground">{t(`${mode}.text`, { price: price[mode] })}</span>
            </button>
          );
        })}
      </div>
      {!dynamicAvailable ? (
        <p id="mode-unavailable" className="flex items-start gap-2 text-caption text-secondary-foreground">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("unavailable", { type: tTypes(type) })}
        </p>
      ) : null}
    </section>
  );
}
