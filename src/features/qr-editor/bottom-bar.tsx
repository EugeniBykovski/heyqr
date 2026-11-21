import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "bbar": the step's action bar. Below 1024 px it sticks to the bottom of the screen (translucent surface,
 * hairline, safe-area padding) and lets go while a field has focus, so the field and its error stay above the
 * keyboard. From 1024 px it sits inline at the end of the step. Put it inside an element with `group/step`.
 */
export function BottomBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="bottom-bar"
      className={cn(
        "sticky bottom-0 z-15 -mx-4 mt-5 flex items-center gap-3 border-t border-border bg-surface/94 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-[10px]",
        "group-has-[input:focus,textarea:focus,select:focus]/step:static sm:-mx-6 sm:px-6",
        "lg:static lg:mx-0 lg:mt-7 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BottomBarInfo({ title, hint, className }: { title: ReactNode; hint: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", className)}>
      <b className="truncate text-[0.9375rem]">{title}</b>
      {/* Design bbar__info: the hint wraps (two lines at most) instead of being cut off on phones. */}
      <span className="line-clamp-2 text-[0.75rem] text-muted-foreground">{hint}</span>
    </div>
  );
}
