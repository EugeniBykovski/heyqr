"use client";

import type { QrCapacity, QrContent } from "@heyqr/qr-core";
import { ChevronDownIcon, CircleAlertIcon, SmartphoneIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { contentDisplayName, isHostedContent, isHostedEmpty, sampleHostedContent, type AnyQrContent, type QrMode } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Segmented } from "@/shared/ui/segmented";
import { BottomBar, BottomBarInfo } from "./bottom-bar";
import { ContentForm } from "./content-form";
import { ContentPreview } from "./content-preview";
import { contentAside, contentStepGrid, previewToggle } from "./editor-layout";
import type { ContentErrors } from "./content-validation";
import { HostedForm } from "./hosted-form";
import type { PdfState } from "./hosted-files";
import { HostedPreview } from "./hosted-preview";
import { TooLongNotice } from "./too-long-notice";

/*
 * Design "1.3–1.5, 1.14 Content" and "10.4–11.15" (hosted pages): the form for the chosen type beside two live
 * previews, "After scan" (what people get) and "QR design" (the code itself). Below 1024 px the previews collapse
 * into a bar above the form. Enter submits; Continue validates, shows each error beside its field and a summary
 * near Continue, and focuses the first error. Everything typed is kept when going back or switching types.
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
  signedIn = false,
  qrPreview,
  shortLabel = "",
  pdfState = { status: "idle" },
  onPdfState = () => undefined,
  hostedNeeds,
}: {
  content: AnyQrContent;
  mode: QrMode;
  name: string;
  errors: ContentErrors;
  showErrors: boolean;
  /** Set when the serialized content doesn't fit a QR code (HEY-24); shown while typing, not only on Continue. */
  tooLong?: QrCapacity | null;
  onContentChange: (content: AnyQrContent) => void;
  onNameChange: (name: string) => void;
  onBack: () => void;
  onContinue: () => void;
  signedIn?: boolean;
  /** The "QR design" preview: the code as it will print. */
  qrPreview?: ReactNode;
  /** The code's short link as shown in previews. */
  shortLabel?: string;
  pdfState?: PdfState;
  onPdfState?: (s: PdfState) => void;
  /** Hosted pages: what publishing needs (plan / slot), from the account. */
  hostedNeeds?: string;
}) {
  const t = useTranslations("editor");
  const tTypes = useTranslations("home.types");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tab, setTab] = useState<"scan" | "qr">("scan");
  const [couponPreview, setCouponPreview] = useState<"valid" | "expired">("valid");
  const hosted = isHostedContent(content) ? content : null;
  const visibleErrors = showErrors ? errors : {};
  const errorCount = Object.keys(visibleErrors).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onContinue();
  };

  const afterScan = hosted ? (
    <HostedPreview content={hosted} shortLabel={shortLabel} forceExpired={hosted.type === "coupon" && couponPreview === "expired"} />
  ) : (
    <ContentPreview content={content as QrContent} mode={mode} />
  );
  const previews = (
    <div className="flex flex-col items-center gap-4">
      {qrPreview ? (
        <Segmented
          label={t("hosted.previewSwitch")}
          className="w-full"
          value={tab}
          options={[
            { value: "scan", label: t("hosted.afterScan") },
            { value: "qr", label: t("hosted.qrDesign") },
          ]}
          onChange={setTab}
        />
      ) : null}
      {tab === "qr" && qrPreview ? (
        <div className="flex w-full max-w-[18.75rem] flex-col items-center gap-3">
          {qrPreview}
          {mode === "dynamic" && shortLabel ? (
            <p className="text-center text-caption text-muted-foreground">{t("hosted.qrNote", { short: shortLabel })}</p>
          ) : null}
        </div>
      ) : (
        afterScan
      )}
    </div>
  );

  return (
    <div className={cn("group/step", contentStepGrid)}>
      <form noValidate onSubmit={submit} aria-labelledby="content-step-title" className="flex min-w-0 flex-col gap-4.5">
        <header className="mb-1 flex max-w-measure flex-col gap-2">
          <span className="text-label text-accent-text">
            {tTypes(`${content.type}.label`)} · {hosted ? `${t("hosted.badge")} · ` : ""}
            {t(`model.${mode}`)}
          </span>
          <h1 id="content-step-title" className="text-h1">
            {t(`contentStep.titles.${content.type}`)}
          </h1>
          <p className="text-secondary-foreground">{t(`contentStep.subs.${content.type}`)}</p>
        </header>

        {hosted ? (
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-subtle p-3.5">
            <Badge variant="accent" className="self-start">
              {t("hosted.badge")}
            </Badge>
            <p className="text-caption text-secondary-foreground">
              {t("hosted.notice", { short: shortLabel || t("hosted.noticePreview"), needs: hostedNeeds ?? "" })}
            </p>
            {isHostedEmpty(hosted) ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="self-start"
                onClick={() => onContentChange(sampleHostedContent(hosted.type))}
              >
                {t("hosted.sample")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="lg:hidden">
          <button
            type="button"
            data-slot="preview-toggle"
            aria-expanded={previewOpen}
            aria-controls="after-scanning"
            onClick={() => setPreviewOpen((o) => !o)}
            className={previewToggle}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-subtle">
              <SmartphoneIcon aria-hidden className="size-5" />
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="text-label">{qrPreview ? t("hosted.previews") : t("afterScanning.label")}</span>
              <span className="truncate text-caption text-muted-foreground">
                {contentDisplayName(content) ?? t("afterScanning.toggleHint")}
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform duration-(--motion-base) data-[open=true]:rotate-180"
              data-open={previewOpen}
            />
          </button>
          {/* Always in the document so aria-controls points at it; hidden while collapsed. */}
          <div id="after-scanning" hidden={!previewOpen} className="animate-rise pt-4 pb-2">
            {previewOpen ? previews : null}
          </div>
        </div>

        {hosted ? (
          <HostedForm
            content={hosted}
            onChange={onContentChange}
            errors={visibleErrors}
            signedIn={signedIn}
            pdfState={pdfState}
            onPdfState={onPdfState}
            couponPreview={couponPreview}
            onCouponPreview={setCouponPreview}
          />
        ) : (
          <ContentForm
            content={content as QrContent}
            onChange={onContentChange}
            errors={visibleErrors}
            hints={
              content.type === "website" ? { url: t(mode === "dynamic" ? "contentStep.urlHintDynamic" : "contentStep.urlHint") } : undefined
            }
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qr-name">
            {t("contentStep.nameLabel")}
            <span className="font-normal text-muted-foreground">· {t("optional")}</span>
          </Label>
          <Input
            id="qr-name"
            value={name}
            maxLength={80}
            placeholder={
              // Design 10.5: an empty Menu suggests "Menu QR"; Website keeps its example name.
              contentDisplayName(content) ??
              (content.type === "website"
                ? t("namePlaceholder")
                : t("contentStep.namePlaceholderType", { type: tTypes(`${content.type}.label`) }))
            }
            aria-describedby="qr-name-hint"
            onChange={(e) => onNameChange(e.target.value)}
          />
          <p id="qr-name-hint" className="text-caption text-muted-foreground">
            {t("contentStep.nameHint")}
          </p>
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

      <aside aria-label={t("afterScanning.label")} className={contentAside}>
        {previews}
      </aside>
    </div>
  );
}
