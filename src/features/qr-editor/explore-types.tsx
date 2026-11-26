"use client";

import type { QrContent } from "@heyqr/qr-core";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { HOSTED_TYPES, isHostedType, sampleHostedContent, type HostedType } from "@/entities/qr";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/shared/config/catalog";
import { usePrices } from "@/shared/lib/currency";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ContentPreview } from "./content-preview";
import { HostedPreview } from "./hosted-preview";
import { TYPE_ICONS } from "./type-icons";
import { draftForType, handOffDraft } from "./use-draft";

/*
 * Design 10.1 / 10.2 "Explore QR types" (home): ten types as tabs (the seven hosted pages, then Website, Wi-Fi and
 * Contact). Picking one updates its use case, the after-scan preview and the CTA in place; the CTA opens the editor
 * on Content with that type preselected (hosted types as Dynamic). Arrow keys, Home and End move between tabs; on
 * phones the tabs wrap into a grid so every type stays visible.
 */
const EXPLORE = [...HOSTED_TYPES, "website", "wifi", "contact"] as const;
type ExploreType = (typeof EXPLORE)[number];

const DIRECT_SAMPLES: Record<"website" | "wifi" | "contact", QrContent> = {
  website: { type: "website", url: "https://anareyes.studio/portfolio" },
  wifi: { type: "wifi", ssid: "Reyes Studio Guest", security: "WPA", password: "linen-orbit-42" },
  contact: {
    type: "contact",
    firstName: "Ana",
    lastName: "Reyes",
    title: "Product designer",
    phone: "+1 415 555 0142",
    email: "hello@reyes.studio",
    website: "anareyes.studio",
  },
};

export function ExploreTypes({ shortLabel }: { shortLabel: string }) {
  const t = useTranslations("home.explore");
  const tTypes = useTranslations("home.types");
  const router = useRouter();
  const prices = usePrices();
  const [current, setCurrent] = useState<ExploreType>("menu");
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Stable ids and a fixed zone: the preview renders the same on the server and in the browser.
  const sample = useMemo(() => {
    if (!isHostedType(current)) return null;
    let n = 0;
    return sampleHostedContent(current as HostedType, { id: () => `x${n++}`, timeZone: "America/Los_Angeles" });
  }, [current]);

  const onKey = (e: KeyboardEvent) => {
    const i = EXPLORE.indexOf(current);
    const n = EXPLORE.length;
    const j =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    const next = EXPLORE[j] ?? "menu";
    setCurrent(next);
    tabs.current[next]?.focus();
  };

  const create = () => {
    handOffDraft(draftForType(current));
    // The type in the URL lets the loading state show that type (design 10.8) and makes the link shareable.
    router.push(`/create?step=content&type=${current}`);
  };

  /* One variant of the copy or checklist per type, stacked in one cell: the cell keeps the tallest height, so
   * switching tabs swaps the panel in place without the page moving (design 10.2). Hidden variants are invisible
   * and inert, so only the current one is read, tabbed to or clicked. */
  const stacked = (render: (key: ExploreType) => ReactNode) => (
    <div className="grid">
      {EXPLORE.map((key) => (
        <div
          key={key}
          aria-hidden={key !== current || undefined}
          inert={key !== current}
          className={cn("col-start-1 row-start-1", key !== current && "invisible")}
        >
          {render(key)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Design 10.1: phones show every type in a grid of tiles; from 640 px one row with an underline, scrolling
          sideways when it doesn't fit. */}
      <div
        role="tablist"
        aria-label={t("tabs")}
        onKeyDown={onKey}
        // Firefox makes a scrolling box a Tab stop of its own; the tabs are the stop (roving tabindex), and the
        // focused tab scrolls itself into view.
        tabIndex={-1}
        className="grid grid-cols-3 gap-2 sm:flex sm:[scrollbar-width:none] sm:gap-0 sm:overflow-x-auto sm:border-b sm:border-border"
      >
        {EXPLORE.map((key) => {
          const Icon = TYPE_ICONS[key];
          const on = key === current;
          return (
            <button
              key={key}
              ref={(el) => {
                tabs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`xp-tab-${key}`}
              aria-selected={on}
              aria-controls="xp-panel"
              tabIndex={on ? 0 : -1}
              onClick={(e) => {
                setCurrent(key);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              className={cn(
                "group relative flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1.5 text-center text-caption transition-colors duration-(--motion-fast)",
                // Phone tile
                "rounded-xl border px-1.5 py-3",
                on
                  ? "border-selected-border bg-selected font-semibold text-foreground"
                  : "border-border bg-surface text-secondary-foreground hover:border-border-hover",
                // Tab row from 640 px: no tile, an underline under the current tab
                "sm:min-w-22 sm:flex-1 sm:shrink-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-3 sm:pt-2 sm:pb-3",
                "sm:after:absolute sm:after:inset-x-2 sm:after:-bottom-px sm:after:h-0.5 sm:after:rounded-full",
                on ? "sm:after:bg-selected-mark" : "sm:hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-lg transition-colors duration-(--motion-fast)",
                  on ? "bg-selected-mark text-inverse-foreground" : "bg-subtle text-secondary-foreground sm:bg-transparent",
                )}
              >
                <Icon aria-hidden className="size-4.5" strokeWidth={1.9} />
              </span>
              <span className="leading-tight">{tTypes(`${key}.label`)}</span>
              {isHostedType(key) ? (
                <span
                  aria-hidden
                  className="absolute top-2 right-2 size-1.5 rounded-full bg-selected-mark sm:top-1.5 sm:right-[calc(50%-1.5rem)]"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-selected-mark" />
        {t("legend")}
      </p>
      {/* Phones: copy, preview, checklist. 768 px: copy and checklist beside the preview. 1024 px: three columns. */}
      <div
        id="xp-panel"
        role="tabpanel"
        aria-labelledby={`xp-tab-${current}`}
        className="grid gap-6 rounded-2xl border border-border bg-surface p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:gap-x-8 lg:grid-cols-[minmax(0,1fr)_20rem_minmax(0,0.8fr)] lg:items-center lg:gap-10"
      >
        <div className="md:col-start-1 md:row-start-1 md:self-start lg:self-center">
          {stacked((key) => {
            const isHosted = isHostedType(key);
            return (
              <div className="flex flex-col items-start gap-3">
                <Badge variant={isHosted ? "accent" : "neutral"}>
                  {isHosted ? t("hostedBadge") : key === "website" ? t("websiteBadge") : t("directBadge")}
                </Badge>
                <h3 className="text-h2">{t(`types.${key}.short`)}</h3>
                <p className="text-secondary-foreground">{t(`types.${key}.use`)}</p>
                <Button variant="primary" size="lg" onClick={create}>
                  {t(`types.${key}.cta`)}
                  <ArrowRightIcon aria-hidden />
                </Button>
                <p className="text-caption text-muted-foreground">
                  {isHosted
                    ? t("hostedPrice", { price: formatMoney(prices.cents.starter, prices.currency) })
                    : t("directPrice", { price: formatMoney(prices.cents.single, prices.currency) })}
                </p>
              </div>
            );
          })}
        </div>
        {/* An invisible hosted phone under the preview keeps the cell one size for every type. */}
        <div className="grid justify-items-center md:col-start-2 md:row-span-2 md:row-start-1 lg:row-span-1">
          <div aria-hidden inert className="invisible col-start-1 row-start-1 w-full">
            <HostedPreview content={null} type="menu" shortLabel={shortLabel} className="w-full" />
          </div>
          <div className="col-start-1 row-start-1 flex w-full justify-center self-start">
            {sample ? (
              <HostedPreview content={sample} shortLabel={shortLabel} className="w-full" />
            ) : (
              <ContentPreview content={DIRECT_SAMPLES[current as "website" | "wifi" | "contact"]} mode="static" className="w-full" />
            )}
          </div>
        </div>
        <div className="md:col-start-1 md:row-start-2 md:self-end lg:col-start-3 lg:row-start-1 lg:self-center">
          {stacked((key) => (
            <div className="flex flex-col gap-2.5">
              <span className="text-label">{t("whatYouGet")}</span>
              <ul className="flex flex-col gap-2">
                {[t(`types.${key}.points.a`), t(`types.${key}.points.b`), isHostedType(key) ? t("hostedExtra") : t("directExtra")].map(
                  (pt) => (
                    <li key={pt} className="flex items-start gap-2 text-[0.9375rem]">
                      <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      {pt}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
