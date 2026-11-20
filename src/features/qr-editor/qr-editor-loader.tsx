"use client";

import { QR_CONTENT_TYPES } from "@heyqr/qr-core";
import { SmartphoneIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonGhostText, SkeletonText, skeletonReveal } from "@/shared/ui/skeleton";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { BottomBar } from "./bottom-bar";
import { ContentPreview } from "./content-preview";
import { ModeChoice } from "./mode-choice";
import {
  contentAside,
  contentStepGrid,
  editorPanel,
  editorRoot,
  editorStage,
  editorTopBar,
  editorTopBarInner,
  previewToggle,
  typeCard,
  typeGrid,
  typeStepRoot,
} from "./editor-layout";

/** Design 1.2 / 5.1: the Type step's catalog (one card per type, the mode card, the action bar) while the editor loads. */
function TypeSkeleton() {
  const t = useTranslations("editor.typeStep");
  const tTypes = useTranslations("home.types");
  return (
    <div className={cn("group/step @container/panel", typeStepRoot)}>
      {/* The heading is fixed copy, so it is shown as is: only what depends on the draft is a placeholder. */}
      <header className="mb-6 flex max-w-measure flex-col gap-2">
        <p className="text-h1">{t("title")}</p>
        <p className="text-secondary-foreground">{t("lead")}</p>
      </header>
      <div className={typeGrid}>
        {QR_CONTENT_TYPES.map((type) => (
          <div key={type} className={typeCard}>
            <Skeleton className="size-12 rounded-md" />
            <span className="flex min-w-0 flex-col gap-1 pr-5">
              <SkeletonGhostText className="text-h3" barClassName="w-1/2" text={tTypes(`${type}.label`)} />
              <SkeletonGhostText className="text-secondary-foreground" barClassName="w-5/6" text={tTypes(`${type}.desc`)} />
              <SkeletonGhostText
                className="truncate text-caption"
                barClassName="w-2/3"
                text={t("example", { example: t(`examples.${type}`) })}
              />
            </span>
          </div>
        ))}
      </div>
      {/* The mode card's own markup, invisible, reserves its exact size; the placeholder sits on top. */}
      <div className="relative mt-5">
        <div aria-hidden className="invisible">
          <ModeChoice type="website" value="static" onChange={() => {}} />
        </div>
        <div className="absolute inset-0 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-1 sm:p-6">
          <div className="flex flex-col gap-1">
            <SkeletonText className="text-h3" barClassName="w-1/2" />
            <SkeletonText className="text-caption" barClassName="w-3/4" />
          </div>
          <div className="grid flex-1 gap-2 @[34rem]/panel:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-1 rounded-lg border border-border p-3.5">
                <SkeletonText className="text-caption" barClassName="w-1/3" />
                <SkeletonText className="text-h3" barClassName="w-1/2" />
                <SkeletonText className="text-caption" barClassName="w-5/6" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomBar>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-3 w-44 rounded-full" />
        </div>
        <Skeleton className="h-control-lg w-32 rounded-full" />
      </BottomBar>
    </div>
  );
}

/**
 * Design 5.1 "Content · loading": the form's boxes and, in the phone, the preview's own loading shapes at the final
 * size (website, the default type). The real form replaces this on the editor's first render; nothing after that waits.
 */
function ContentSkeleton({ label }: { label: string }) {
  const t = useTranslations("editor");
  const tTypes = useTranslations("home.types");
  return (
    <div className={cn("group/step", contentStepGrid)}>
      <div className="flex min-w-0 flex-col gap-4.5">
        <div className="mb-1 flex max-w-measure flex-col gap-2">
          <SkeletonGhostText className="text-label" barClassName="w-28" text={`${tTypes("website.label")} · ${t("model.static")}`} />
          <SkeletonGhostText className="text-h1" barClassName="w-3/4" text={t("contentStep.titles.website")} />
          <SkeletonGhostText className="text-secondary-foreground" text={t("contentStep.subs.website")} />
        </div>
        <div className="lg:hidden">
          <div data-slot="preview-toggle" className={previewToggle}>
            <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-subtle">
              <SmartphoneIcon aria-hidden className="size-5 text-muted-foreground" />
            </span>
            <span className="flex min-w-0 grow flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28 rounded-full" />
              <Skeleton className="h-3 w-48 max-w-full rounded-full" />
            </span>
          </div>
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <SkeletonText className="text-label" barClassName="w-28" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
        ))}
        <BottomBar>
          <Skeleton className="h-11 w-20 rounded-full max-sm:hidden" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:hidden">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-3 w-36 rounded-full" />
          </div>
          <span className="grow max-sm:hidden" />
          <Skeleton className="h-control-lg w-44 rounded-full" />
        </BottomBar>
      </div>
      <div className={contentAside}>
        <ContentPreview content={{ type: "website", url: "" }} mode="static" loading />
      </div>
      <p role="status" className="sr-only">
        {label}
      </p>
    </div>
  );
}

/** Loading state with the editor's exact boxes for the step in the URL, so the swap to the real editor doesn't shift. */
export function EditorSkeleton({ design = false }: { design?: boolean }) {
  const t = useTranslations("loading");
  const params = useSearchParams();
  const step = params.get("step");
  if (!design && step !== "design" && !params.get("resume"))
    return (
      <div aria-busy="true" aria-label={t("editor")} className={cn("flex flex-col", skeletonReveal)}>
        <div className={editorTopBar}>
          <div className={editorTopBarInner}>
            <div className="flex flex-1">
              <Skeleton className="h-9 w-9 rounded-full sm:w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-16 rounded-full max-sm:hidden" />
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="size-8 rounded-full" />
            </div>
            <div className="flex flex-1 justify-end" />
          </div>
        </div>
        {step === "content" ? <ContentSkeleton label={t("editor")} /> : <TypeSkeleton />}
      </div>
    );
  return (
    <div aria-busy="true" aria-label={t("editor")} className={cn("flex flex-col", skeletonReveal)}>
      <div className={editorTopBar}>
        <div className={editorTopBarInner}>
          <div className="flex flex-1">
            <Skeleton className="h-9 w-9 rounded-full sm:w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3 w-16 rounded-full max-sm:hidden" />
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-8 rounded-full" />
          </div>
          <div className="flex flex-1 justify-end">
            <Skeleton className="h-9 w-28 rounded-full max-sm:hidden" />
          </div>
        </div>
      </div>
      <div className={editorRoot}>
        <div className={editorStage}>
          <Stage className="rounded-xl">
            <StageBar>
              <Skeleton className="mx-1 my-1 h-4 w-1/3 rounded-full" />
            </StageBar>
            {/* The canvas keeps its final height and square art box from the first frame (design 5.2). */}
            <StageCanvas>
              <Skeleton className="size-full rounded-lg bg-skeleton-accent" />
            </StageCanvas>
            <p role="status" className="sr-only">
              {t("editor")}
            </p>
            <StageFoot>
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-11 w-36 rounded-full max-lg:hidden" />
            </StageFoot>
          </Stage>
        </div>
        <div className={editorPanel}>
          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-28 rounded-full" />
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            ))}
          </div>
          <Skeleton className="mb-3 h-3.5 w-40 rounded-full" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-header rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The editor reads the guest draft from localStorage on first render, so it is rendered in the browser only. */
export const QrEditorLoader = dynamic(() => import("./qr-editor").then((m) => m.QrEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
