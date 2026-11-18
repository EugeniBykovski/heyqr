import { cn } from "@/shared/lib/utils";

/*
 * Design "lib-list" / "qcard": cards on phones, two columns from 600 px, and from 1024 px one bordered list
 * whose rows are thumbnail 64 px | name and badges | actions. Shared with the loading skeleton.
 */
export const libraryList = cn(
  "grid gap-3 sm:grid-cols-2",
  "lg:grid-cols-1 lg:gap-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-border lg:bg-surface",
);

export const libraryRow = cn(
  "grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-3 rounded-xl border border-border bg-surface p-3.5",
  "lg:grid-cols-[4rem_minmax(0,1.4fr)_auto] lg:rounded-none lg:border-0 lg:border-b lg:px-5 lg:py-3 lg:last:border-b-0",
);

/** Select mode (design 4.10): a checkbox column first, actions hidden; a selected row is tinted violet. */
export const libraryRowSelecting = cn(
  "grid-cols-[1.75rem_4.75rem_minmax(0,1fr)] lg:grid-cols-[1.75rem_4rem_minmax(0,1fr)]",
  "transition-[border-color,background-color,box-shadow] duration-(--motion-fast)",
);
export const libraryRowSelected = "border-selected-border bg-selected ring-1 ring-selected-border lg:ring-inset";

export const libraryThumb = "grid size-19 shrink-0 place-items-center rounded-md bg-subtle p-2 lg:size-16";
export const libraryActions = "col-span-full flex flex-wrap items-center gap-1.5 lg:col-auto lg:justify-end";
