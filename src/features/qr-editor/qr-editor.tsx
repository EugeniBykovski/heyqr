"use client";

import { composeLayout, encodePayload, type QrContentType } from "@heyqr/qr-core";
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Tabs as TabsPrimitive } from "radix-ui";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { env } from "@/env";
import { designSettingsOf, designToLayout, emptyContent, isContentComplete, modeFor, QrPreview, type EditorDesign } from "@/entities/qr";
import { Link, useRouter } from "@/i18n/navigation";
import { saveDraft } from "@/server/actions/qr";
import { pricing } from "@/shared/config/pricing";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { BottomBar, BottomBarInfo } from "./bottom-bar";
import { ContentStep } from "./content-step";
import { contentErrors } from "./content-validation";
import { DesignPanel } from "./design-panel";
import { editorPanel, editorRoot, editorStage, editorTopBar, editorTopBarInner } from "./editor-layout";
import { EditorSteps } from "./editor-steps";
import { FramePanel } from "./frame-panel";
import { ScanStatus } from "./scan-status";
import { TypeStep } from "./type-step";
import { clearDraft, useDraft } from "./use-draft";

/** Placeholder encoded in dynamic previews: the real short code is assigned when the plan starts. */
const DYNAMIC_PREVIEW_CODE = "preview";
export const EDITOR_STEPS = ["type", "content", "design"] as const;
export type EditorStep = (typeof EDITOR_STEPS)[number];
const isStep = (v: string | null): v is EditorStep => EDITOR_STEPS.includes(v as EditorStep);

/**
 * Design "editor": Type → Content → Design, then Export. The step lives in the URL (?step=), so refresh, browser
 * Back/Forward and reopening land on the same step; the draft itself is the versioned guest draft (use-draft).
 */
export function QrEditor({ signedIn, resume }: { signedIn: boolean; resume: boolean }) {
  const t = useTranslations("editor");
  const tErrors = useTranslations("errors");
  const tTypes = useTranslations("contentTypes");
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const { design, setDesign, restored, unreadable, modeAdjusted } = useDraft();
  const urlStep = params.get("step");
  const step: EditorStep = resume ? "design" : isStep(urlStep) ? urlStep : "type";
  const [showErrors, setShowErrors] = useState(false);
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

  const errors = useMemo(() => contentErrors(design.content), [design.content]);
  const complete = isContentComplete(design.content) && Object.keys(errors).length === 0;
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

  /** Steps are URL state: pushState keeps browser Back working without a server round trip. */
  const goTo = (next: EditorStep) => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", next);
    url.searchParams.delete("resume");
    window.history.pushState(null, "", url);
    window.scrollTo({ top: 0 });
  };

  /** Content must be valid before Design; otherwise show the errors and focus the first one. */
  const toDesign = () => {
    const keys = Object.keys(errors);
    if (keys.length === 0) return goTo("design");
    setShowErrors(true);
    if (step !== "content") goTo("content");
    window.setTimeout(() => document.getElementById(`content-${keys[0]}`)?.focus(), 50);
  };

  const requestStep = (target: EditorStep) => (target === "design" ? toDesign() : goTo(target));

  /** A new type keeps the mode when it supports it; otherwise it becomes Static and the user is told. */
  const changeType = (type: QrContentType) => {
    if (type === design.content.type) return;
    const model = modeFor(type, design.model);
    if (model !== design.model) toast(t("mode.switched", { type: tTypes(type) }), { id: "mode-switched" });
    setShowErrors(false);
    patch({ content: emptyContent(type), model });
  };

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

  const exportButton = (size: "sm" | "md" | "lg", className?: string) => (
    <Button variant="primary" size={size} className={className} disabled={!canDownload} aria-busy={saving || undefined} onClick={download}>
      {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
      {saving ? t("saving") : t("export")}
      {!saving ? <ArrowRightIcon aria-hidden /> : null}
    </Button>
  );

  const back =
    step === "type" ? (
      <Button asChild variant="ghost" size="sm">
        <Link href="/">
          <ArrowLeftIcon aria-hidden />
          <span className="max-sm:sr-only">{t("backTo.home")}</span>
        </Link>
      </Button>
    ) : (
      <Button variant="ghost" size="sm" onClick={() => goTo(step === "content" ? "type" : "content")}>
        <ArrowLeftIcon aria-hidden />
        <span className="max-sm:sr-only">{t(step === "content" ? "backTo.type" : "backTo.content")}</span>
      </Button>
    );

  return (
    <TabsPrimitive.Root value={step} onValueChange={(v) => requestStep(v as EditorStep)} className="flex flex-col">
      <div className={editorTopBar}>
        <div className={editorTopBarInner}>
          <div className="flex min-w-0 flex-1">{back}</div>
          <EditorSteps label={t("stepsLabel")} current={step} steps={EDITOR_STEPS.map((s) => ({ value: s, label: t(`steps.${s}`) }))} />
          <div className="flex min-w-0 flex-1 items-center justify-end">
            {step === "design" ? (
              exportButton("sm", "max-sm:hidden")
            ) : (
              <span className="text-caption text-muted-foreground max-lg:hidden">{t("previewFrom", { price })}</span>
            )}
          </div>
        </div>
      </div>

      <TabsPrimitive.Content value="type" className="animate-rise outline-none">
        <TypeStep
          type={design.content.type}
          mode={design.model}
          onTypeChange={changeType}
          onModeChange={(model) => patch({ model })}
          onContinue={() => goTo("content")}
        />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="content" className="animate-rise outline-none">
        <ContentStep
          content={design.content}
          mode={design.model}
          name={design.name}
          errors={errors}
          showErrors={showErrors}
          onContentChange={(content) => patch({ content })}
          onNameChange={(name) => patch({ name })}
          onBack={() => goTo("type")}
          onContinue={toDesign}
        />
      </TabsPrimitive.Content>

      <TabsPrimitive.Content value="design" className="animate-rise outline-none">
        <div className={`${editorRoot} group/step`}>
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
                {exportButton("md", "max-lg:hidden")}
              </StageFoot>
            </Stage>
          </section>

          <section aria-label={t("settings")} className={editorPanel}>
            <h1 className="sr-only">{t("steps.design")}</h1>
            {!scan.ok ? (
              <div className="mb-5">
                <ScanStatus report={scan} />
              </div>
            ) : null}
            <div className="flex flex-col gap-8">
              <DesignPanel design={design} onChange={patch} />
              <section aria-labelledby="design-frame" className="flex flex-col gap-4 border-t border-border pt-6">
                <h2 id="design-frame" className="text-h3">
                  {t("frameGroup")}
                </h2>
                <FramePanel design={design} onChange={patch} />
              </section>
            </div>
            <BottomBar className="lg:hidden">
              <BottomBarInfo title={t(design.model === "dynamic" ? "pricePerMonth" : "priceOnce", { price })} hint={t("previewFree")} />
              {exportButton("md")}
            </BottomBar>
          </section>
        </div>
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
