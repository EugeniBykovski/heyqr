"use client";

import { composeLayout, encodePayload, type QrContent } from "@heyqr/qr-core";
import { ArrowRightIcon, CircleAlertIcon, InfoIcon, LockIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { env } from "@/env";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign, emptyContent, modeFor, QR_INKS, QrPreview } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { pricing } from "@/shared/config/pricing";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input, InputPrefix } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Segmented } from "@/shared/ui/segmented";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { Swatch } from "@/shared/ui/swatch";
import { ContentForm } from "./content-form";
import { contentErrors } from "./content-validation";
import { ScanStatus } from "./scan-status";
import { readDraft, writeDraft } from "./use-draft";

/** Types the quick builder edits in place; "more" opens the editor's Type step. */
const QUICK_TYPES = ["website", "wifi", "contact"] as const;
type QuickType = (typeof QUICK_TYPES)[number];
type Tab = QuickType | "more";
const isQuickType = (t: string): t is QuickType => (QUICK_TYPES as readonly string[]).includes(t);

/** Fields shown on the homepage; the rest of each type's fields are in the editor's Content step. */
const QUICK_FIELDS: Record<QuickType, readonly string[]> = {
  website: ["url"],
  wifi: ["ssid", "password", "security"],
  contact: ["firstName", "lastName", "phone", "email"],
};
const PLACEHOLDER_VALUE = "https://heyqr.app";

const bareUrl = (url: string) => url.replace(/^https?:\/\//i, "");

/**
 * Design "hero": the real tool on the first screen. Copy, live stage and tool card share one grid:
 * stacked on phones and tablets (copy → stage → tool), two columns from 1024 px.
 * Website, Wi-Fi and Contact are edited right here with the editor's fields, validation and payload builder; what is
 * typed is the guest draft the editor opens with "Continue designing". QR data never goes into the URL.
 */
export function QuickStart({ copy }: { copy: ReactNode }) {
  const t = useTranslations("home.tool");
  const tTypes = useTranslations("contentTypes");
  const tEditor = useTranslations("editor");
  const format = useFormatter();
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
  const value =
    design.model === "dynamic"
      ? `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/preview`
      : valid
        ? encodePayload(design.content)
        : PLACEHOLDER_VALUE;
  const layout = useMemo(() => designToLayout(design), [design]);
  const scan = useMemo(() => composeLayout(layout, value).scan, [layout, value]);
  const price = format.number(pricing.staticCents / 100, { style: "currency", currency: pricing.currency });

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

      {/* The preview supports the form: compact, and on desktop it stays in view while the form is filled in. */}
      <div className="[grid-area:stage] lg:sticky lg:top-[calc(var(--spacing-header)+1.5rem)] lg:mt-1">
        <Stage>
          <StageBar>
            <span className="min-w-0 grow truncate px-1 text-label">{t("stageTitle", { type: tTypes(type) })}</span>
            <Badge variant={scan.ok && valid ? "success" : "neutral"}>{scan.ok && valid ? t("scans") : t("livePreview")}</Badge>
          </StageBar>
          <StageCanvas height="clamp(13.75rem, 26cqi, 26rem)">
            <QrPreview layout={layout} value={value} label={t("previewLabel")} className="size-full" />
          </StageCanvas>
          <StageFoot>
            <ScanStatus report={scan} compact />
            <span className="text-caption text-muted-foreground">{t("realCode")}</span>
          </StageFoot>
        </Stage>
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
              <InputPrefix>https://</InputPrefix>
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
                onChange={(e) => setContent({ type: "website", url: e.target.value ? `https://${bareUrl(e.target.value)}` : "" })}
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
          <div className="flex flex-col gap-2">
            <label htmlFor="home-caption" className="text-label">
              {t("caption")}
            </label>
            <Textarea
              id="home-caption"
              rows={2}
              value={design.caption}
              maxLength={60}
              className="min-h-19 resize-none"
              onChange={(e) => patch({ caption: e.target.value, preset: e.target.value.trim() ? "caption" : "qr" })}
            />
          </div>
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
