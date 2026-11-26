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
  // HEY-64: below 1024 px the sticky preview lets go while a text field in the settings has focus (like the bottom
  // bar), so with the on-screen keyboard open it can't cover the field and its error. Sliders keep it in view.
  "max-lg:group-has-[input:not([type=range]):focus,textarea:focus,select:focus]/ed:static",
  "lg:order-1 lg:bg-transparent lg:px-6 lg:py-5 xl:px-10 xl:py-6 2xl:px-16 2xl:py-8",
);

export const editorPanel = cn(
  "@container/panel min-w-0 px-4 pt-4 sm:mx-auto sm:w-full sm:max-w-[47.5rem] sm:px-6 sm:pt-5",
  "lg:order-0 lg:m-0 lg:min-h-[calc(var(--stage-canvas-h)+13.75rem)] lg:max-w-none lg:border-e lg:border-border lg:bg-surface lg:pb-8",
);

export const editorTopBar = "border-b border-border bg-surface";
export const editorTopBarInner = "mx-auto flex min-h-14 max-w-wide items-center gap-2 px-2 sm:px-4";

/* Content step (design 1.3–1.5, 5.1), shared with its loading skeleton: form | "After scanning" phone from 1024 px. */
export const contentStepGrid = cn(
  "mx-auto grid w-full max-w-page gap-6 px-4 pt-6 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_23.75rem] lg:items-start lg:gap-14 lg:px-8 lg:pt-10 lg:pb-16",
  "xl:grid-cols-[minmax(0,38.75rem)_26.25rem] xl:justify-center xl:gap-24",
);
export const contentAside = "sticky top-[calc(var(--spacing-header)+1.5rem)] max-lg:hidden";
/** Below 1024 px: the "After scanning" bar that opens the phone above the form. */
export const previewToggle =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-start";

/* Type step (design 1.2): the type catalog, shared with its loading skeleton. */
export const typeStepRoot = "mx-auto w-full max-w-[56.25rem] px-4 pt-6 pb-8 sm:px-6 lg:px-8 lg:pt-10 lg:pb-16";
/** One shrinkable column on phones (an implicit auto column grew to the cards' text and overflowed 320 px), two from 480 px. */
export const typeGrid = "grid grid-cols-[minmax(0,1fr)] gap-3 min-[30rem]:grid-cols-2";
export const typeCard = "relative flex min-h-28 items-start gap-4 rounded-xl border border-border bg-surface p-4.5 text-start";
