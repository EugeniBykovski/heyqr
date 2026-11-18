"use client";

import { composeLayout, encodePayload } from "@heyqr/qr-core";
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Tabs as TabsPrimitive } from "radix-ui";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { env } from "@/env";
import { designSettingsOf, designToLayout, isContentComplete, modeFor, QrPreview, type EditorDesign } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { saveDraft } from "@/server/actions/qr";
import { pricing } from "@/shared/config/pricing";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { ContentForm } from "./content-form";
import { DesignPanel } from "./design-panel";
import { editorPanel, editorRoot, editorStage, editorTopBar, editorTopBarInner } from "./editor-layout";
import { EditorSteps } from "./editor-steps";
import { FramePanel } from "./frame-panel";
import { ScanStatus } from "./scan-status";
import { clearDraft, useDraft } from "./use-draft";

/** Placeholder encoded in dynamic previews: the real short code is assigned when the plan starts. */
const DYNAMIC_PREVIEW_CODE = "preview";
const STEPS = ["content", "design", "frame"] as const;
type Step = (typeof STEPS)[number];

export function QrEditor({ signedIn, resume }: { signedIn: boolean; resume: boolean }) {
  const t = useTranslations("editor");
  const tErrors = useTranslations("errors");
  const tTypes = useTranslations("contentTypes");
  const format = useFormatter();
  const router = useRouter();
  const { design, setDesign, restored, unreadable, modeAdjusted } = useDraft();
  const [step, setStep] = useState<Step>("content");
  const [saving, startSaving] = useTransition();
  const autoResumed = useRef(false);
  const patch = (p: Partial<EditorDesign>) => setDesign((d) => ({ ...d, ...p }));

  useEffect(() => {
    // Fixed id: shown once even when the effect runs twice (React Strict Mode in development).
    if (restored && !resume) toast(t("draftRestored"), { id: "draft-restored" });
    // A malformed draft or one from a newer version is kept aside, not overwritten; the editor starts fresh.
    if (unreadable) toast(t("draftUnreadable"), { id: "draft-unreadable" });
    // A draft from an earlier build had Dynamic on a type that can't redirect; it was kept as Static.
    if (modeAdjusted) toast(t("mode.adjusted"), { id: "mode-adjusted" });
  }, [restored, unreadable, modeAdjusted, resume, t]);

  /** New content keeps the mode when its type supports it; otherwise it becomes Static and the user is told. */
  const changeContent = (content: EditorDesign["content"]) => {
    const model = modeFor(content.type, design.model);
    if (model !== design.model) toast(t("mode.switched", { type: tTypes(content.type) }), { id: "mode-switched" });
    patch({ content, model });
  };

  const complete = isContentComplete(design.content);
  const value = useMemo(() => {
    if (design.model === "dynamic") return `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${DYNAMIC_PREVIEW_CODE}`;
    return complete ? encodePayload(design.content) : "https://heyqr.app";
  }, [design.model, design.content, complete]);
  const layout = useMemo(() => designToLayout({ ...design, caption: design.caption || t("captionPlaceholder") }), [design, t]);
  const scan = useMemo(() => composeLayout(layout, value).scan, [layout, value]);
  const price = format.number((design.model === "dynamic" ? pricing.dynamicMonthlyCents : pricing.staticCents) / 100, {
    style: "currency",
    currency: pricing.currency,
  });
  const canDownload = complete && scan.ok && !saving;

  const download = () =>
    startSaving(async () => {
      if (!signedIn) {
        router.push(`/sign-in?next=${encodeURIComponent("/create?resume=1")}`);
        return;
      }
      const name = design.name.trim() || t("namePlaceholder");
      const destination = design.model === "dynamic" && design.content.type === "website" ? encodePayload(design.content) : undefined;
      const result = await saveDraft({
        name,
        model: design.model,
        content: design.content,
        destination,
        layouts: [{ name, layout, editor: designSettingsOf(design) }],
      });
      if (!result.ok) {
        toast.error(tErrors(result.error === "unauthorized" || result.error === "invalid" ? result.error : "generic"));
        return;
      }
      clearDraft();
      router.push(`/create/export?qr=${result.data.qrCodeId}&layout=${result.data.layoutIds[0]}`);
    });

  // Coming back from Google sign-in: continue to the export step automatically.
  const continueAfterSignIn = useEffectEvent(() => {
    if (autoResumed.current || !complete || !scan.ok) return;
    autoResumed.current = true;
    download();
  });
  useEffect(() => {
    if (resume && signedIn && restored) continueAfterSignIn();
  }, [resume, signedIn, restored]);

  const downloadButton = (size: "sm" | "md" | "lg", className?: string) => (
    <Button variant="primary" size={size} className={className} disabled={!canDownload} aria-busy={saving || undefined} onClick={download}>
      {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
      {saving ? t("saving") : t("download")}
      {!saving ? <ArrowRightIcon aria-hidden /> : null}
    </Button>
  );

  return (
    <TabsPrimitive.Root value={step} onValueChange={(v) => setStep(v as Step)} className="flex flex-col">
      <div className={editorTopBar}>
        <div className={editorTopBarInner}>
          <div className="flex min-w-0 flex-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeftIcon aria-hidden />
                <span className="max-sm:sr-only">{t("back")}</span>
              </Link>
            </Button>
          </div>
          <EditorSteps label={t("stepsLabel")} current={step} steps={STEPS.map((s) => ({ value: s, label: t(`steps.${s}`) }))} />
          <div className="flex min-w-0 flex-1 justify-end">{downloadButton("sm", "max-sm:hidden")}</div>
        </div>
      </div>

      <div className={editorRoot}>
        <section aria-label={t("preview")} className={editorStage}>
          <Stage className="rounded-xl">
            <StageBar>
              <span className="min-w-0 grow truncate px-1 text-label">{design.name.trim() || t("namePlaceholder")}</span>
              <Badge variant={design.model === "dynamic" ? "accent" : "neutral"}>{t(`model.${design.model}`)}</Badge>
            </StageBar>
            <StageCanvas className="select-none">
              <div className="relative size-full">
                <QrPreview layout={layout} value={value} label={t("preview")} className="size-full" />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 grid -rotate-30 place-items-center text-h1 font-bold tracking-[0.3em] text-foreground/7 uppercase"
                >
                  {t("preview")}
                </span>
              </div>
            </StageCanvas>
            <StageFoot>
              <ScanStatus report={scan} compact />
              <span className="text-caption text-muted-foreground max-lg:hidden">{t("previewNote")}</span>
              {downloadButton("md", "max-lg:hidden")}
            </StageFoot>
          </Stage>
        </section>

        <section aria-label={t("settings")} className={editorPanel}>
          <div className="mb-5 flex flex-col gap-4">
            <Field id="qr-name" label={t("name")}>
              <Input
                id="qr-name"
                value={design.name}
                maxLength={80}
                placeholder={t("namePlaceholder")}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
          </div>

          {!scan.ok ? (
            <div className="mb-5">
              <ScanStatus report={scan} />
            </div>
          ) : null}

          <TabsPrimitive.Content value="content" className="animate-rise outline-none">
            <ContentForm content={design.content} onChange={changeContent} mode={design.model} onModeChange={(model) => patch({ model })} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="design" className="animate-rise outline-none">
            <DesignPanel design={design} onChange={patch} />
          </TabsPrimitive.Content>
          <TabsPrimitive.Content value="frame" className="animate-rise outline-none">
            <FramePanel design={design} onChange={patch} />
          </TabsPrimitive.Content>

          {/* Phones and tablets: sticky action bar with the price; it stops being sticky while a field has focus,
              so the field and its error stay visible above the keyboard. */}
          <div className="sticky bottom-0 z-10 -mx-4 mt-7 flex items-center gap-3 border-t border-border bg-page/92 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md group-has-[input:focus,textarea:focus,select:focus]/ed:static sm:-mx-6 sm:px-6 lg:hidden">
            <div className="flex min-w-0 flex-1 flex-col">
              <b className="text-[0.9375rem]">{t(design.model === "dynamic" ? "pricePerMonth" : "priceOnce", { price })}</b>
              <span className="truncate text-[0.75rem] text-muted-foreground">{t("previewFree")}</span>
            </div>
            {downloadButton("md")}
          </div>
        </section>
      </div>
    </TabsPrimitive.Root>
  );
}
