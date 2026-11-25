"use client";

import { QR_CONTENT_TYPES } from "@heyqr/qr-core";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { HOSTED_TYPES, isHostedType, type QrMode, type QrType } from "@/entities/qr";
import { formatMoney } from "@/shared/config/catalog";
import { usePrices } from "@/shared/lib/currency";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { BottomBar, BottomBarInfo } from "./bottom-bar";
import { typeCard, typeGrid, typeStepRoot } from "./editor-layout";
import { ModeChoice } from "./mode-choice";
import { TYPE_ICONS } from "./type-icons";

/*
 * Design "1.2 Type" / "10.3": what the code should open, in two groups: the nine types that open straight from the
 * code, and the seven hosted pages (always Dynamic). Below the direct types, whether the link can change after printing. The bar shows the current choice and continues to Content.
 */
export function TypeStep({
  type,
  mode,
  onTypeChange,
  onModeChange,
  onContinue,
}: {
  type: QrType;
  mode: QrMode;
  onTypeChange: (type: QrType) => void;
  onModeChange: (mode: QrMode) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("editor");
  const tTypes = useTranslations("home.types");
  const prices = usePrices();
  const money = (cents: number | null) => formatMoney(cents, prices.currency);
  const hosted = isHostedType(type);

  const card = (value: QrType) => {
    const Icon = TYPE_ICONS[value];
    const selected = value === type;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={selected}
        onClick={() => onTypeChange(value)}
        className={cn(
          typeCard,
          "group cursor-pointer transition-[border-color,box-shadow,background-color] duration-(--motion-fast) hover:border-border-hover hover:shadow-2 aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
        )}
      >
        {selected ? (
          <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-selected-mark text-inverse-foreground">
            <CheckIcon aria-hidden strokeWidth={3.2} className="size-3" />
          </span>
        ) : null}
        <span className="grid size-12 shrink-0 place-items-center rounded-md bg-subtle transition-colors duration-(--motion-fast) group-aria-pressed:bg-selected-mark group-aria-pressed:text-inverse-foreground">
          <Icon aria-hidden className="size-6" strokeWidth={1.9} />
        </span>
        <span className="flex min-w-0 flex-col gap-1 pr-5">
          <span className="text-h3">{tTypes(`${value}.label`)}</span>
          <span className="text-secondary-foreground">{tTypes(`${value}.desc`)}</span>
          <span className="truncate text-caption text-muted-foreground">
            {t("typeStep.example", { example: t(`typeStep.examples.${value}`) })}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className={cn("group/step @container/panel", typeStepRoot)}>
      <header className="mb-6 flex max-w-measure flex-col gap-2">
        <h1 className="text-h1">{t("typeStep.title")}</h1>
        <p className="text-secondary-foreground">{t("typeStep.lead")}</p>
      </header>
      <h2 className="mb-2.5 text-label text-secondary-foreground">{t("typeStep.directGroup")}</h2>
      <div role="group" aria-label={t("typeStep.directGroupLabel")} className={typeGrid}>
        {QR_CONTENT_TYPES.map((value) => card(value))}
      </div>
      <section aria-labelledby="hosted-group" className="mt-8">
        <div className="mb-3 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="hosted-group" className="text-h3">
              {t("typeStep.hostedGroup")}
            </h2>
            <Badge variant="accent">{t("typeStep.hostedNew")}</Badge>
          </div>
          <p className="max-w-measure text-caption text-secondary-foreground">
            {t("typeStep.hostedLead", { starter: money(prices.cents.starter), studio: money(prices.cents.studio) })}
          </p>
        </div>
        <div role="group" aria-labelledby="hosted-group" className={typeGrid}>
          {HOSTED_TYPES.map((value) => card(value))}
        </div>
      </section>
      {/* Hosted pages are always Dynamic: no Static/Dynamic question (design 10.3). */}
      {hosted ? null : (
        <div className="mt-5">
          <ModeChoice type={type} value={mode} onChange={onModeChange} />
        </div>
      )}
      <BottomBar>
        <BottomBarInfo
          title={
            hosted
              ? t("typeStep.hostedSummary", { type: tTypes(`${type}.label`) })
              : type === "website"
                ? `${tTypes(`${type}.label`)} · ${t(`model.${mode}`)}`
                : tTypes(`${type}.label`)
          }
          hint={t("typeStep.next")}
        />
        <Button variant="primary" size="lg" onClick={onContinue}>
          {t("continue")}
        </Button>
      </BottomBar>
    </div>
  );
}
