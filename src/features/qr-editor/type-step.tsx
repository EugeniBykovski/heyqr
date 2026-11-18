"use client";

import { QR_CONTENT_TYPES, type QrContentType } from "@heyqr/qr-core";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QrMode } from "@/entities/qr";
import { Button } from "@/shared/ui/button";
import { BottomBar, BottomBarInfo } from "./bottom-bar";
import { ModeChoice } from "./mode-choice";
import { TYPE_ICONS } from "./type-icons";

/*
 * Design "1.2 Type": what the code should open (type cards with a description and an example) and, below,
 * whether the link can change after printing. The bar shows the current choice and continues to Content.
 */
export function TypeStep({
  type,
  mode,
  onTypeChange,
  onModeChange,
  onContinue,
}: {
  type: QrContentType;
  mode: QrMode;
  onTypeChange: (type: QrContentType) => void;
  onModeChange: (mode: QrMode) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("editor");
  const tTypes = useTranslations("home.types");

  return (
    <div className="group/step @container/panel mx-auto w-full max-w-[56.25rem] px-4 pt-6 pb-8 sm:px-6 lg:px-8 lg:pt-10 lg:pb-16">
      <header className="mb-6 flex max-w-measure flex-col gap-2">
        <h1 className="text-h1">{t("typeStep.title")}</h1>
        <p className="text-secondary-foreground">{t("typeStep.lead")}</p>
      </header>
      <div role="group" aria-label={t("typeStep.groupLabel")} className="grid gap-3 min-[30rem]:grid-cols-2">
        {QR_CONTENT_TYPES.map((value) => {
          const Icon = TYPE_ICONS[value];
          const selected = value === type;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => onTypeChange(value)}
              className="group relative flex min-h-28 cursor-pointer items-start gap-4 rounded-xl border border-border bg-surface p-4.5 text-left transition-[border-color,box-shadow,background-color] duration-(--motion-fast) hover:border-border-hover hover:shadow-2 aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]"
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
        })}
      </div>
      <div className="mt-5">
        <ModeChoice type={type} value={mode} onChange={onModeChange} />
      </div>
      <BottomBar>
        <BottomBarInfo
          title={type === "website" ? `${tTypes(`${type}.label`)} · ${t(`model.${mode}`)}` : tTypes(`${type}.label`)}
          hint={t("typeStep.next")}
        />
        <Button variant="primary" size="lg" onClick={onContinue}>
          {t("continue")}
        </Button>
      </BottomBar>
    </div>
  );
}
