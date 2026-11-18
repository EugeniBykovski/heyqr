"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/shared/ui/skeleton";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { editorPanel, editorRoot, editorStage, editorTopBar, editorTopBarInner } from "./editor-layout";

/** Design 5.1: the Type step's cards and the Content step's form + "After scanning" phone, while the editor loads. */
function StepSkeleton({ step }: { step: "type" | "content" }) {
  if (step === "type")
    return (
      <div className="mx-auto w-full max-w-[56.25rem] px-4 pt-6 pb-8 sm:px-6 lg:px-8 lg:pt-10 lg:pb-16">
        <div className="mb-6 flex max-w-measure flex-col gap-3">
          <Skeleton className="h-8 w-2/3 rounded-full" />
          <Skeleton className="h-4 w-full rounded-full" />
        </div>
        <div className="grid gap-3 min-[30rem]:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex min-h-28 items-start gap-4 rounded-xl border border-border bg-surface p-4.5">
              <Skeleton className="size-12 rounded-md" />
              <div className="flex flex-1 flex-col gap-2.5 pt-1">
                <Skeleton className="h-4.5 w-1/2 rounded-full" />
                <Skeleton className="h-3 w-5/6 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="mx-auto grid w-full max-w-page gap-6 px-4 pt-6 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start lg:gap-14 lg:px-8 lg:pt-10 lg:pb-16 xl:grid-cols-[minmax(0,38.75rem)_26.25rem] xl:justify-center xl:gap-24">
      <div className="flex flex-col gap-4.5">
        <div className="mb-1 flex max-w-measure flex-col gap-3">
          <Skeleton className="h-3.5 w-24 rounded-full" />
          <Skeleton className="h-8 w-3/4 rounded-full" />
          <Skeleton className="h-4 w-full rounded-full" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-28 rounded-full" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="mt-2 h-12 w-full rounded-full sm:w-48" />
      </div>
      <div className="flex flex-col gap-3 max-lg:hidden">
        <Skeleton className="h-3.5 w-28 rounded-full" />
        <div className="flex flex-col gap-3 rounded-[2rem] border border-border bg-surface p-4">
          <Skeleton className="h-8 w-full rounded-full" />
          <Skeleton className="h-30 w-full rounded-lg" />
          <Skeleton className="h-4 w-4/5 rounded-full" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-2/3 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Loading state with the editor's exact boxes for the step in the URL, so the swap to the real editor doesn't shift. */
export function EditorSkeleton() {
  const params = useSearchParams();
  const step = params.get("step");
  if (step !== "design" && !params.get("resume"))
    return (
      <div aria-busy="true" className="flex flex-col">
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
        <StepSkeleton step={step === "content" ? "content" : "type"} />
      </div>
    );
  return (
    <div aria-busy="true" className="flex flex-col">
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
              <Skeleton className="m-1.5 h-3.5 w-1/3 rounded-full" />
            </StageBar>
            <StageCanvas>
              <Skeleton className="size-full rounded-lg bg-skeleton-accent" />
            </StageCanvas>
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
              <Skeleton key={i} className="h-15 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The editor reads the guest draft from localStorage on first render, so it is rendered in the browser only. */
export const QrEditorLoader = dynamic(() => import("./qr-editor").then((m) => m.QrEditor), { ssr: false, loading: EditorSkeleton });
