"use client";

import { CheckIcon } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Fragment } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "steps": numbered pills joined by hairlines. Current = filled violet number on a subtle pill;
 * done = violet-500 number with a check. Phones show only the current label.
 * They are tabs (role=tab, aria-selected), so arrow keys move between steps.
 */
export function EditorSteps<T extends string>({
  label,
  steps,
  current,
}: {
  label: string;
  steps: { value: T; label: string }[];
  current: T;
}) {
  const index = steps.findIndex((s) => s.value === current);
  return (
    <TabsPrimitive.List aria-label={label} className="flex min-w-0 items-center gap-0.5">
      {steps.map((s, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <Fragment key={s.value}>
            {i > 0 ? <span aria-hidden className="h-px w-4 shrink-0 bg-border-hover sm:w-7" /> : null}
            <TabsPrimitive.Trigger
              value={s.value}
              className={cn(
                "group inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full py-1 pr-3 pl-1 text-label text-muted-foreground",
                "transition-colors duration-(--motion-fast) hover:bg-subtle",
                "data-[state=active]:bg-subtle data-[state=active]:text-foreground",
                done && "text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-6.5 shrink-0 place-items-center rounded-full border-[1.5px] border-current text-[0.75rem] transition-colors duration-(--motion-base)",
                  active && "border-transparent bg-primary text-primary-foreground",
                  done && "border-transparent bg-selected-mark text-inverse-foreground",
                )}
              >
                {done ? <CheckIcon aria-hidden strokeWidth={3} className="size-3.5" /> : i + 1}
              </span>
              <span className={cn(!active && "max-sm:sr-only")}>{s.label}</span>
            </TabsPrimitive.Trigger>
          </Fragment>
        );
      })}
    </TabsPrimitive.List>
  );
}
