"use client";

import type { QrContent } from "@heyqr/qr-core";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { draftForType, writeDraft } from "./use-draft";

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
  const hosted = isHostedType(current);
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
    writeDraft(draftForType(current));
    router.push("/create?step=content");
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t("tabs")}
        onKeyDown={onKey}
        className="grid grid-cols-2 gap-1.5 min-[30rem]:grid-cols-3 sm:flex sm:flex-wrap"
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
              onClick={() => setCurrent(key)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-label transition-colors duration-(--motion-fast)",
                on ? "border-inverse bg-inverse text-inverse-foreground" : "border-border bg-surface hover:border-border-hover",
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{tTypes(`${key}.label`)}</span>
              {isHostedType(key) ? (
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-inverse-accent" : "bg-accent-strong")} />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-accent-strong" />
        {t("legend")}
      </p>
      <div
        id="xp-panel"
        role="tabpanel"
        aria-labelledby={`xp-tab-${current}`}
        className="grid gap-6 rounded-2xl border border-border bg-surface p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_20rem_minmax(0,0.8fr)] lg:items-center lg:gap-10"
      >
        <div className="flex flex-col items-start gap-3">
          <Badge variant={hosted ? "accent" : "neutral"}>
            {hosted ? t("hostedBadge") : current === "website" ? t("websiteBadge") : t("directBadge")}
          </Badge>
          <h3 className="text-h2">{t(`types.${current}.short`)}</h3>
          <p className="text-secondary-foreground">{t(`types.${current}.use`)}</p>
          <Button variant="primary" size="lg" onClick={create}>
            {t(`types.${current}.cta`)}
            <ArrowRightIcon aria-hidden />
          </Button>
          <p className="text-caption text-muted-foreground">
            {hosted
              ? t("hostedPrice", { price: formatMoney(prices.cents.starter, prices.currency) })
              : t("directPrice", { price: formatMoney(prices.cents.single, prices.currency) })}
          </p>
        </div>
        <div className="flex justify-center">
          {sample ? (
            <HostedPreview content={sample} shortLabel={shortLabel} className="w-full" />
          ) : (
            <ContentPreview content={DIRECT_SAMPLES[current as "website" | "wifi" | "contact"]} mode="static" className="w-full" />
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="text-label">{t("whatYouGet")}</span>
          <ul className="flex flex-col gap-2">
            {[t(`types.${current}.points.a`), t(`types.${current}.points.b`), hosted ? t("hostedExtra") : t("directExtra")].map((p) => (
              <li key={p} className="flex items-start gap-2 text-[0.9375rem]">
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
