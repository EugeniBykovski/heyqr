"use client";

import { composeLayout, encodePayload } from "@heyqr/qr-core";
import { ArrowRightIcon, CircleAlertIcon, InfoIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_DESIGN, designToLayout, emptyContent, QR_INKS, QrPreview, type EditorDesign } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { pricing } from "@/shared/config/pricing";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input, InputPrefix } from "@/shared/ui/input";
import { Segmented } from "@/shared/ui/segmented";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { Swatch } from "@/shared/ui/swatch";
import { ScanStatus } from "./scan-status";
import { readDraft, writeDraft } from "./use-draft";

type HomeType = "website" | "wifi" | "contact" | "more";
const HOME_TYPES: readonly HomeType[] = ["website", "wifi", "contact", "more"];
const PLACEHOLDER_VALUE = "https://heyqr.app";

function bareUrl(url: string) {
  return url.replace(/^https?:\/\//i, "");
}

/**
 * Design "hero": the real tool on the first screen. Copy, live stage and tool card share one grid:
 * stacked on phones and tablets (copy → stage → tool), two columns from 1024 px with the stage spanning both rows.
 * Everything typed here is the same guest draft the editor opens with "Continue designing".
 */
export function QuickStart({ copy }: { copy: ReactNode }) {
  const t = useTranslations("home.tool");
  const tTypes = useTranslations("contentTypes");
  const format = useFormatter();
  const router = useRouter();
  const ids = useId();
  const urlRef = useRef<HTMLInputElement>(null);
  const [design, setDesign] = useState<EditorDesign>(() => ({ ...DEFAULT_DESIGN, preset: "caption", caption: t("captionDefault") }));
  const [tried, setTried] = useState(false);

  // The draft lives in localStorage, so it is restored after hydration to keep server and client markup identical.
  useEffect(() => {
    const saved = readDraft();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
    if (saved) setDesign(saved);
  }, []);

  const url = design.content.type === "website" ? bareUrl(design.content.url) : "";
  const urlError = /\s/.test(url.trim()) ? t("errors.spaces") : tried && !url.trim() ? t("errors.empty") : null;
  const value = design.content.type === "website" && url.trim() && !urlError ? encodePayload(design.content) : PLACEHOLDER_VALUE;
  const layout = useMemo(() => designToLayout(design), [design]);
  const scan = useMemo(() => composeLayout(layout, value).scan, [layout, value]);
  const price = format.number(pricing.staticCents / 100, { style: "currency", currency: pricing.currency });

  const patch = (p: Partial<EditorDesign>) => setDesign((d) => ({ ...d, ...p }));
  const goToEditor = (next: EditorDesign) => {
    writeDraft(next);
    router.push("/create");
  };
  const pickType = (type: HomeType) => {
    if (type === "website") {
      if (design.content.type !== "website") patch({ content: emptyContent("website") });
      return;
    }
    goToEditor(type === "more" ? design : { ...design, content: emptyContent(type) });
  };
  const onContinue = () => {
    if (design.content.type === "website" && (!url.trim() || /\s/.test(url.trim()))) {
      setTried(true);
      urlRef.current?.focus();
      return;
    }
    goToEditor(design);
  };

  return (
    <section
      className={cn(
        "grid gap-5 pt-6 pb-10 [grid-template-areas:'copy'_'stage'_'tool'] sm:gap-6 sm:pt-10",
        "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-x-14 lg:gap-y-7 lg:pt-16 lg:pb-20 lg:[grid-template-areas:'copy_stage'_'tool_stage']",
        "2xl:gap-x-28 2xl:pt-26",
      )}
    >
      <div className="flex max-w-[40rem] flex-col gap-3.5 [grid-area:copy]">{copy}</div>

      <div className="[grid-area:stage] lg:self-stretch">
        <Stage className="h-full">
          <StageBar>
            <span className="min-w-0 grow truncate text-label">{t("stageTitle", { type: tTypes(design.content.type) })}</span>
            <Badge variant={scan.ok ? "success" : "neutral"}>{scan.ok ? t("scans") : t("livePreview")}</Badge>
          </StageBar>
          <StageCanvas height="clamp(13.75rem, 34cqi, 32.5rem)" className="lg:h-auto lg:min-h-(--stage-canvas-h) lg:flex-1">
            <QrPreview layout={layout} value={value} label={t("previewLabel")} className="size-full" />
          </StageCanvas>
          <StageFoot>
            <ScanStatus report={scan} compact />
            <span className="text-caption text-muted-foreground">{t("realCode")}</span>
          </StageFoot>
        </Stage>
      </div>

      <Card className="gap-4 p-4 [grid-area:tool] sm:p-5">
        <Segmented
          label={t("typesLabel")}
          value={(HOME_TYPES as readonly string[]).includes(design.content.type) ? (design.content.type as HomeType) : "more"}
          options={HOME_TYPES.map((v) => ({ value: v, label: v === "more" ? t("more") : tTypes(v) }))}
          onChange={pickType}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-url`} className="text-label">
            {t("url")}
          </label>
          <div className="flex min-w-0 items-stretch">
            <InputPrefix>https://</InputPrefix>
            <Input
              ref={urlRef}
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder={t("urlPlaceholder")}
              className="rounded-l-none"
              value={url}
              aria-invalid={urlError ? true : undefined}
              aria-describedby={urlError ? `${ids}-url-error` : undefined}
              onChange={(e) => patch({ content: { type: "website", url: e.target.value ? `https://${bareUrl(e.target.value)}` : "" } })}
            />
          </div>
          {urlError ? (
            <p
              id={`${ids}-url-error`}
              className="flex animate-rise items-start gap-1.5 text-caption font-medium text-danger [animation-duration:var(--motion-fast)]"
            >
              <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {urlError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 min-[26.875rem]:grid-cols-[auto_minmax(0,1fr)] lg:max-[80rem]:grid-cols-1">
          <div className="flex flex-col gap-1.5">
            <span id={`${ids}-color`} className="text-label">
              {t("color")}
            </span>
            <div role="group" aria-labelledby={`${ids}-color`} className="flex flex-wrap gap-2">
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-caption`} className="text-label">
              {t("caption")}
            </label>
            <Input
              id={`${ids}-caption`}
              value={design.caption}
              maxLength={40}
              onChange={(e) => patch({ caption: e.target.value, preset: e.target.value.trim() ? "caption" : "qr" })}
            />
          </div>
        </div>

        <Button variant="primary" size="lg" className="w-full" onClick={onContinue}>
          {t("continue")}
          <ArrowRightIcon aria-hidden />
        </Button>
        <p className="flex items-start gap-2 text-caption text-secondary-foreground">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
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
