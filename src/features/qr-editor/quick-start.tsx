"use client";

import { composeLayout, encodePayload, layoutCapacity, type QrContent } from "@heyqr/qr-core";
import { ArrowRightIcon, CircleAlertIcon, InfoIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { env } from "@/env";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign, emptyContent, modeFor, QR_INKS, QrPreview } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/shared/config/catalog";
import { usePrices } from "@/shared/lib/currency";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input, InputPrefix } from "@/shared/ui/input";

import { Segmented } from "@/shared/ui/segmented";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { Swatch } from "@/shared/ui/swatch";
import { bareUrl, fromAddressField, schemeOf } from "./address-field";
import { CaptionField } from "./caption-field";
import { ContentForm } from "./content-form";
import { contentErrors } from "./content-validation";
import { ScanStatus } from "./scan-status";
import { TooLongNotice } from "./too-long-notice";
import { readDraft, writeDraft } from "./use-draft";

/** Types the quick builder edits in place; "more" opens the editor's Type step. */
const QUICK_TYPES = ["website", "wifi", "contact"] as const;
type QuickType = (typeof QUICK_TYPES)[number];
type Tab = QuickType | "more";
const isQuickType = (t: string): t is QuickType => (QUICK_TYPES as readonly string[]).includes(t);

/** Fields shown on the homepage; the rest of each type's fields are in the editor's Content step. */
const QUICK_FIELDS: Record<QuickType, readonly string[]> = {
  website: ["url"],
  wifi: ["ssid", "security", "password"],
  contact: ["firstName", "lastName", "phone", "email"],
};
const PLACEHOLDER_VALUE = "https://heyqr.app";

/**
 * Design "hero": the real tool on the first screen. Copy, live stage and tool card share one grid:
 * stacked on phones and tablets (copy → stage → tool), two columns from 1024 px.
 * Website, Wi-Fi and Contact are edited right here with the editor's fields, validation and payload builder; what is
 * typed is the guest draft the editor opens with "Continue designing". QR data never goes into the URL.
 */
export function QuickStart({ copy, revealLine }: { copy: ReactNode; revealLine: string }) {
  const t = useTranslations("home.tool");
  const tTypes = useTranslations("contentTypes");
  const tEditor = useTranslations("editor");
  const router = useRouter();
  const [design, setDesign] = useState<EditorDesign>(() => ({ ...DEFAULT_DESIGN, preset: "caption", caption: t("captionDefault") }));
  /** What was typed on each tab during this visit, so switching away and back keeps it. */
  const [byType, setByType] = useState<Record<QuickType, QrContent>>(() => ({
    website: emptyContent("website"),
    wifi: emptyContent("wifi"),
    contact: emptyContent("contact"),
  }));
  const [tried, setTried] = useState(false);

  // The draft lives in localStorage, so it is restored after hydration to keep server and client markup identical.
  useEffect(() => {
    const saved = readDraft();
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
    setDesign(saved);
    const savedType = saved.content.type;
    if (isQuickType(savedType)) setByType((m) => ({ ...m, [savedType]: saved.content }));
  }, []);

  const type = design.content.type;
  const quick = isQuickType(type) ? type : null;
  const errors = useMemo(() => contentErrors(design.content), [design.content]);
  const valid = Object.keys(errors).length === 0;
  // A website address with spaces is flagged while typing; everything else after the first Continue.
  const shownErrors = tried ? errors : errors.url === "urlSpaces" ? { url: errors.url } : {};
  const layout = useMemo(() => designToLayout(design), [design]);
  // Same rule as the editor (HEY-24): capacity is checked on what the code would actually hold.
  const encoded =
    design.model === "dynamic" ? `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/preview` : encodePayload(design.content);
  const capacity = useMemo(() => layoutCapacity(layout, encoded), [layout, encoded]);
  const tooLong = capacity.ok ? null : capacity;
  const value = design.model === "dynamic" || valid || tooLong ? encoded : PLACEHOLDER_VALUE;
  const scan = useMemo(() => (tooLong ? null : composeLayout(layout, value).scan), [layout, value, tooLong]);
  const prices = usePrices();
  const price = formatMoney(prices.cents.single, prices.currency);

  const patch = (p: Partial<EditorDesign>) => setDesign((d) => ({ ...d, ...p }));
  const setContent = (content: QrContent) => {
    patch({ content });
    const ct = content.type;
    if (isQuickType(ct)) setByType((m) => ({ ...m, [ct]: content }));
  };

  /** The draft goes through browser storage only; the URL carries just the step. */
  const openEditor = (next: EditorDesign, step: "type" | "content" | "design") => {
    writeDraft(next);
    router.push(`/create?step=${step}`);
  };

  /** Website / Wi-Fi / Contact switch in place; "More +" opens the full type catalog with the current draft. */
  const pickTab = (tab: Tab) => {
    if (tab === "more") return openEditor(design, "type");
    if (tab === type) return;
    setTried(false);
    patch({ content: byType[tab], model: modeFor(tab, design.model) });
  };

  /** Valid → Design. A problem in a field shown here → stay and focus it. A problem only the editor shows → Content. */
  const onContinue = () => {
    const keys = Object.keys(errors);
    if (tooLong) {
      // The notice under the form says what to shorten; keep everything typed and focus the first field.
      window.setTimeout(() => document.querySelector<HTMLElement>("[id^=content-]:is(input, textarea)")?.focus(), 30);
      return;
    }
    if (keys.length === 0) return openEditor(design, "design");
    const first = keys.find((k) => quick !== null && QUICK_FIELDS[quick].includes(k));
    if (!first) return openEditor(design, "content");
    setTried(true);
    window.setTimeout(() => document.getElementById(`content-${first}`)?.focus(), 30);
  };

  const urlError = shownErrors.url;

  return (
    <section
      className={cn(
        "grid gap-5 pt-6 pb-10 [grid-template-areas:'copy'_'stage'_'tool'] sm:gap-6 sm:pt-10",
        "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)] lg:items-start lg:gap-x-12 lg:gap-y-7 lg:pt-16 lg:pb-20 lg:[grid-template-areas:'copy_stage'_'tool_stage']",
        "2xl:gap-x-24 2xl:pt-26",
      )}
    >
      <div className="flex max-w-[40rem] flex-col gap-3.5 [grid-area:copy]">{copy}</div>

      {/*
       * HEY-47 hero reveal. On desktop with motion allowed, the preview column fills the hero: the card keeps its sticky
       * descent through the whole column (as before HEY-46) and comes to rest at its bottom. The empty area below the
       * card holds the line, centred both ways; the opaque card is layered above it, so on its way down the card passes
       * in front of the line and at one point covers all of it. Scrolling back up uncovers it. Phones, tablets and
       * reduced motion: the line is centred in normal flow below the preview. Only this column takes part; the form
       * and Continue designing are in their own column.
       */}
      <div className="flex flex-col [grid-area:stage] lg:mt-1 motion-safe:lg:self-stretch">
        <div
          data-slot="hero-preview"
          className="relative z-10 motion-safe:lg:sticky motion-safe:lg:top-[calc(var(--spacing-header)+1.5rem)]"
        >
          <Stage>
            <StageBar>
              <span className="min-w-0 grow truncate px-1 text-label">{t("stageTitle", { type: tTypes(type) })}</span>
              <Badge variant={tooLong ? "danger" : scan?.ok && valid ? "success" : "neutral"}>
                {tooLong ? tEditor("tooLong.badge") : scan?.ok && valid ? t("scans") : t("livePreview")}
              </Badge>
            </StageBar>
            <StageCanvas height="clamp(13.75rem, 26cqi, 26rem)">
              <QrPreview
                layout={layout}
                value={value}
                label={t("previewLabel")}
                tooLongLabel={tEditor("tooLong.preview")}
                className="size-full"
              />
            </StageCanvas>
            <StageFoot>
              {scan ? <ScanStatus report={scan} compact /> : null}
              <span className="text-caption text-muted-foreground">{t("realCode")}</span>
            </StageFoot>
          </Stage>
        </div>
        <div data-slot="hero-sweep" className="mt-8 grid place-items-center motion-safe:lg:mt-0 motion-safe:lg:flex-1 motion-safe:lg:py-12">
          <p data-slot="hero-reveal" className="w-full text-center text-display text-foreground">
            {revealLine}
          </p>
        </div>
      </div>

      <Card className="gap-6 p-5 [grid-area:tool] sm:gap-7 sm:p-6">
        <Segmented
          label={t("typesLabel")}
          value={quick ?? undefined}
          options={(["website", "wifi", "contact", "more"] as const).map((v) => ({
            value: v,
            label: v === "more" ? t("more") : tTypes(v),
          }))}
          onChange={pickTab}
        />

        {design.content.type === "website" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="content-url" className="text-label">
              {t("url")}
            </label>
            <div className="flex min-w-0 items-stretch">
              <InputPrefix>{schemeOf(design.content.url)}</InputPrefix>
              <Input
                id="content-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder={t("urlPlaceholder")}
                className="rounded-l-none"
                value={bareUrl(design.content.url)}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? "content-url-error" : undefined}
                onChange={(e) =>
                  setContent({
                    type: "website",
                    url: fromAddressField(e.target.value, design.content.type === "website" ? design.content.url : ""),
                  })
                }
              />
            </div>
            {urlError ? (
              <p
                id="content-url-error"
                className="flex animate-rise items-start gap-1.5 text-caption font-medium text-danger [animation-duration:var(--motion-fast)]"
              >
                <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {tEditor(`errors.${urlError}` as "errors.text")}
              </p>
            ) : null}
          </div>
        ) : quick ? (
          <ContentForm content={design.content} onChange={setContent} errors={shownErrors} fields={QUICK_FIELDS[quick]} />
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-subtle px-3.5 py-3 text-caption text-secondary-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("otherType", { type: tTypes(type) })}
          </p>
        )}

        {tooLong ? <TooLongNotice capacity={tooLong} /> : null}

        <div className="grid gap-6 min-[26.875rem]:grid-cols-[auto_minmax(0,1fr)] lg:max-[80rem]:grid-cols-1">
          <div className="flex flex-col gap-2">
            <span id="home-color" className="text-label">
              {t("color")}
            </span>
            <div role="group" aria-labelledby="home-color" className="flex flex-wrap gap-2">
              {QR_INKS.slice(0, 5).map((ink) => (
                <Swatch
                  key={ink.hex}
                  color={ink.hex}
                  selected={design.fg.toUpperCase() === ink.hex}
                  aria-label={t(`inks.${ink.name}`)}
                  title={t(`inks.${ink.name}`)}
                  onClick={() => patch({ fg: ink.hex })}
                />
              ))}
            </div>
          </div>
          <CaptionField
            id="home-caption"
            label={t("caption")}
            value={design.caption}
            onAccept={(caption) => patch({ caption, preset: caption.trim() ? "caption" : "qr" })}
          />
        </div>

        <Button variant="primary" size="lg" className="w-full" onClick={onContinue}>
          {t("continue")}
          <ArrowRightIcon aria-hidden />
        </Button>
        <p className="flex items-start gap-2 pt-0.5 text-caption leading-[1.6] text-secondary-foreground">
          <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {t.rich("priceNote", { price, b: (chunks) => <b className="font-semibold text-foreground">{chunks}</b> })}{" "}
            <Link href="/pricing" className="font-semibold text-foreground underline underline-offset-3">
              {t("seePricing")}
            </Link>
          </span>
        </p>
      </Card>
    </section>
  );
}
