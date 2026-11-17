import { cn } from "@/shared/lib/utils";

/*
 * Design "ed": one fluid layout, shared by the editor and its loading skeleton so nothing shifts on load.
 *   < 600     one column: compact sticky preview (canvas 196 px) above the settings, sticky bottom action bar
 *   600–1023  preview 340 px above settings capped at 760 px
 *   ≥ 1024    settings panel 400 px | sticky canvas 452 px (500 at 1280, 580 + 440 px panel at 1440, 700 + 480 at 1920)
 */
export const editorRoot = cn(
  "group/ed mx-auto flex w-full max-w-wide flex-col",
  "[--stage-canvas-h:12.25rem] sm:[--stage-canvas-h:21.25rem] lg:[--stage-canvas-h:28.25rem] min-[80rem]:[--stage-canvas-h:31.25rem] xl:[--stage-canvas-h:36.25rem] 2xl:[--stage-canvas-h:43.75rem]",
  "[--panel-width:25rem] xl:[--panel-width:27.5rem] 2xl:[--panel-width:30rem]",
  "lg:grid lg:grid-cols-[var(--panel-width)_minmax(0,1fr)] lg:items-start",
);

export const editorStage = cn(
  "sticky top-header z-[12] bg-page px-3 py-2 sm:px-6 sm:py-3",
  "lg:order-1 lg:bg-transparent lg:px-6 lg:py-5 xl:px-10 xl:py-6 2xl:px-16 2xl:py-8",
);

export const editorPanel = cn(
  "@container/panel min-w-0 px-4 pt-4 sm:mx-auto sm:w-full sm:max-w-[47.5rem] sm:px-6 sm:pt-5",
  "lg:order-0 lg:m-0 lg:min-h-[calc(var(--stage-canvas-h)+13.75rem)] lg:max-w-none lg:border-r lg:border-border lg:bg-surface lg:pb-8",
);

export const editorTopBar = "border-b border-border bg-surface";
export const editorTopBarInner = "mx-auto flex min-h-14 max-w-wide items-center gap-2 px-2 sm:px-4";
