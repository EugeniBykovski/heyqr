import { getFormatter, getTranslations } from "next-intl/server";
import type { Usage } from "@/server/billing/allowances";
import { formatMoney, type Currency } from "@/shared/config/catalog-core";
import { cn } from "@/shared/lib/utils";

/*
 * Design 4.9 / 9.6 / 9.7 usage: live Dynamic slots, this billing month's static unlocks and included Print Packs, and
 * static credits, each against its limit. A live count is not monthly; monthly allowances say when they reset.
 */
export async function UsageTiles({
  usage,
  printPackCents,
  currency,
  credits = "auto",
  className,
}: {
  usage: Usage;
  printPackCents: number | null;
  currency: Currency;
  /** Show the static credits tile: always, never, or when there are credits (or no plan). */
  credits?: "always" | "never" | "auto";
  className?: string;
}) {
  const [t, format] = await Promise.all([getTranslations("billing"), getFormatter()]);
  const plan = usage.plan;
  const month = plan ? format.dateTime(plan.periodStart, { month: "long" }) : "";
  const resets = plan?.periodEnd ? t("resets", { date: format.dateTime(plan.periodEnd, { dateStyle: "medium" }) }) : "";
  const tiles: { k: string; tag: string; used?: number; limit?: number; n: number; of: string; note: string; live?: boolean }[] = [];
  if (plan) {
    tiles.push({
      k: t("tiles.dynamic"),
      tag: t("tiles.live"),
      used: usage.dynamic.used,
      limit: usage.dynamic.limit,
      n: usage.dynamic.used,
      of: t("of", { limit: usage.dynamic.limit }),
      note: t("tiles.dynamicNote"),
      live: true,
    });
    tiles.push({
      k: t("tiles.unlocks"),
      tag: month,
      used: usage.unlocks.used,
      limit: usage.unlocks.limit,
      n: usage.unlocks.used,
      of: t("of", { limit: usage.unlocks.limit }),
      note: resets,
    });
    if (usage.packs.limit)
      tiles.push({
        k: t("tiles.packs"),
        tag: month,
        used: usage.packs.used,
        limit: usage.packs.limit,
        n: usage.packs.used,
        of: t("of", { limit: usage.packs.limit }),
        note: t("tiles.packsNote", { resets, price: formatMoney(printPackCents, currency) }),
      });
  }
  if (credits === "always" || (credits === "auto" && (usage.credits > 0 || !plan)))
    tiles.push({ k: t("tiles.credits"), tag: t("tiles.oneTime"), n: usage.credits, of: t("left"), note: t("tiles.creditsNote") });
  if (!tiles.length) return null;
  return (
    <div className={cn("grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4", className)}>
      {tiles.map((x) => (
        <div
          key={x.k}
          className={cn(
            "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3.5",
            x.live && "shadow-[inset_3px_0_0_var(--selected-border)]",
          )}
        >
          <div className="flex items-start justify-between gap-2 text-caption font-semibold text-secondary-foreground">
            <span>{x.k}</span>
            <span className="shrink-0 font-medium">{x.tag}</span>
          </div>
          <span className="text-[0.875rem]">
            <b className="text-h3 tabular-nums">{x.n}</b> {x.of}
          </span>
          {x.limit !== undefined && x.used !== undefined ? (
            <div
              role="meter"
              aria-label={x.k}
              aria-valuemin={0}
              aria-valuemax={x.limit}
              aria-valuenow={x.used}
              className="h-1.5 overflow-hidden rounded-full bg-subtle"
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${x.limit ? Math.min(100, (x.used / x.limit) * 100) : 0}%` }}
              />
            </div>
          ) : null}
          {x.note ? <span className="text-caption text-muted-foreground">{x.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
