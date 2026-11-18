"use client";

import type { QrCapacity, QrContent } from "@heyqr/qr-core";
import { ChevronDownIcon, CircleAlertIcon, SmartphoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { QrMode } from "@/entities/qr";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { BottomBar, BottomBarInfo } from "./bottom-bar";
import { ContentForm } from "./content-form";
import { ContentPreview } from "./content-preview";
import type { ContentErrors } from "./content-validation";
import { TooLongNotice } from "./too-long-notice";

/*
 * Design "1.3–1.5, 1.14 Content": the form for the chosen type beside an "After scanning" phone preview
 * (a collapsible bar above the form below 1024 px). Enter submits; Continue validates and focuses the first error.
 */
export function ContentStep({
  content,
  mode,
  name,
  errors,
  showErrors,
  tooLong,
  onContentChange,
  onNameChange,
  onBack,
  onContinue,
}: {
  content: QrContent;
  mode: QrMode;
  name: string;
  errors: ContentErrors;
  showErrors: boolean;
  /** Set when the serialized content doesn't fit a QR code (HEY-24); shown while typing, not only on Continue. */
  tooLong?: QrCapacity | null;
  onContentChange: (content: QrContent) => void;
  onNameChange: (name: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const t = useTranslations("editor");
  const tTypes = useTranslations("home.types");
  const [previewOpen, setPreviewOpen] = useState(false);
  const visibleErrors = showErrors ? errors : {};
  const errorCount = Object.keys(visibleErrors).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onContinue();
  };

  return (
    <div className="group/step mx-auto grid w-full max-w-page gap-6 px-4 pt-6 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start lg:gap-14 lg:px-8 lg:pt-10 lg:pb-16 xl:grid-cols-[minmax(0,38.75rem)_26.25rem] xl:justify-center xl:gap-24">
      <form noValidate onSubmit={submit} aria-labelledby="content-step-title" className="flex min-w-0 flex-col gap-4.5">
        <header className="mb-1 flex max-w-measure flex-col gap-2">
          <span className="text-label text-accent-text">
            {tTypes(`${content.type}.label`)} · {t(`model.${mode}`)}
          </span>
          <h1 id="content-step-title" className="text-h1">
            {t(`contentStep.titles.${content.type}`)}
          </h1>
          <p className="text-secondary-foreground">{t(`contentStep.subs.${content.type}`)}</p>
        </header>

        <div className="lg:hidden">
          <button
            type="button"
            aria-expanded={previewOpen}
            aria-controls="after-scanning"
            onClick={() => setPreviewOpen((o) => !o)}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-subtle">
              <SmartphoneIcon aria-hidden className="size-5" />
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="text-label">{t("afterScanning.label")}</span>
              <span className="truncate text-caption text-muted-foreground">{t("afterScanning.toggleHint")}</span>
            </span>
            <ChevronDownIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-(--motion-base) data-[open=true]:rotate-180"
              data-open={previewOpen}
            />
          </button>
          {previewOpen ? (
            <div id="after-scanning" className="animate-rise pt-4 pb-2">
              <ContentPreview content={content} mode={mode} />
            </div>
          ) : null}
        </div>

        <ContentForm content={content} onChange={onContentChange} errors={visibleErrors} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qr-name">
            {t("contentStep.nameLabel")}
            <span className="font-normal text-muted-foreground">· {t("optional")}</span>
          </Label>
          <Input
            id="qr-name"
            value={name}
            maxLength={80}
            placeholder={t("namePlaceholder")}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>

        {tooLong ? <TooLongNotice id="content-too-long" capacity={tooLong} /> : null}

        {errorCount ? (
          <div
            role="alert"
            className="flex animate-rise items-start gap-3 rounded-md bg-danger-soft px-3.5 py-3 text-[0.875rem] leading-[1.45] text-danger"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{errorCount === 1 ? t("contentStep.errorsOne") : t("contentStep.errorsMany", { count: errorCount })}</span>
          </div>
        ) : null}

        <BottomBar>
          <Button type="button" variant="ghost" className="max-sm:hidden" onClick={onBack}>
            {t("contentStep.back")}
          </Button>
          <BottomBarInfo className="sm:hidden" title={t("contentStep.stepOf")} hint={t("contentStep.kept")} />
          <span className="grow max-sm:hidden" />
          <Button type="submit" variant="primary" size="lg">
            {t("contentStep.continue")}
          </Button>
        </BottomBar>
      </form>

      <aside aria-label={t("afterScanning.label")} className="sticky top-[calc(var(--spacing-header)+1.5rem)] max-lg:hidden">
        <ContentPreview content={content} mode={mode} />
      </aside>
    </div>
  );
}
