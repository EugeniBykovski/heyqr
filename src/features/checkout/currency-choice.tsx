"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Segmented } from "@/shared/ui/segmented";

/** Display currencies offered by the design (7.1). Only `charged` has prices you can pay; others show a notice. */
export const DISPLAY_CURRENCIES = ["USD", "GBP", "PLN"] as const;
type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
const KEY = "heyqr:display-currency";

/*
 * Design 4.8 / 7.1 "Show prices in": a viewer preference, independent of the interface language. The prices shown and
 * charged come from the server's configuration (one currency today). Choosing a currency without its own price points
 * says so plainly instead of showing converted or invented amounts; receipts always keep the currency that was paid.
 */
export function CurrencyChoice({ charged }: { charged: string }) {
  const t = useTranslations("pricing.currency");
  const [chosen, setChosen] = useState<DisplayCurrency>(charged as DisplayCurrency);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a browser-only preference, read after hydration
      if (saved && (DISPLAY_CURRENCIES as readonly string[]).includes(saved)) setChosen(saved as DisplayCurrency);
    } catch {
      /* no stored preference */
    }
  }, []);
  const choose = (c: DisplayCurrency) => {
    setChosen(c);
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="text-label">{t("label")}</span>
        <Segmented
          label={t("label")}
          value={chosen}
          options={DISPLAY_CURRENCIES.map((c) => ({ value: c, label: c }))}
          onChange={(v) => choose(v as DisplayCurrency)}
        />
      </div>
      {chosen !== charged ? (
        <p
          role="status"
          className="flex max-w-xl items-start gap-2 rounded-md bg-subtle px-3.5 py-3 text-[0.875rem] text-secondary-foreground"
        >
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {t("unavailable", { chosen, charged })}
        </p>
      ) : null}
    </div>
  );
}
