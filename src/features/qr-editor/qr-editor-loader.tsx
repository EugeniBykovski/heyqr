"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/shared/ui/skeleton";
import { Stage, StageBar, StageCanvas, StageFoot } from "@/shared/ui/stage";
import { editorPanel, editorRoot, editorStage, editorTopBar, editorTopBarInner } from "./editor-layout";

/** Loading state with the editor's exact boxes (top bar, stage, panel), so the swap to the real editor doesn't shift. */
export function EditorSkeleton() {
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
