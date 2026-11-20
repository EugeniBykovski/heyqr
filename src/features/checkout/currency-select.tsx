"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { setCurrency } from "@/server/actions/billing";
import { CURRENCIES, type Currency } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", PLN: "zł" };

/*
 * Design 4.8 / 7.1 "Show prices in" (USD / EUR / PLN): the viewer's currency, kept in a cookie so every page (Home,
 * Pricing, Export, Print Preview, checkout) renders and charges the same currency. Independent of the language.
 */
export function CurrencySelect({ value, label }: { value: Currency; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending || undefined}
      className="inline-flex rounded-full border border-border bg-subtle p-0.5"
    >
      {CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await setCurrency(c);
              if (result.ok) router.refresh();
            })
          }
          className={cn(
            "min-h-9 cursor-pointer rounded-full px-3.5 text-[0.8125rem] font-semibold text-secondary-foreground tabular-nums",
            "disabled:cursor-wait aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment",
          )}
        >
          {c} {SYMBOL[c]}
        </button>
      ))}
    </div>
  );
}
