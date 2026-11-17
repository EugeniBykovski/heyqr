"use client";

import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/** A labelled group of toggle buttons (design: "option cards"); one value is selected. */
export function OptionGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  render,
  columns = "grid-cols-4",
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  render: (option: T) => ReactNode;
  columns?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-label">{label}</legend>
      <div className={cn("grid gap-2", columns)}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option)}
              className={cn(
                "relative flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-surface p-2 text-[0.8125rem] leading-tight font-semibold",
                "transition-[border-color,box-shadow,background-color] duration-(--motion-fast) hover:border-border-hover",
                "aria-pressed:border-selected-border aria-pressed:bg-selected aria-pressed:shadow-[0_0_0_1px_var(--color-selected-border)]",
              )}
            >
              {selected ? (
                <span className="absolute top-1.75 right-1.75 grid size-5 place-items-center rounded-full bg-selected-mark text-inverse-foreground">
                  <CheckIcon aria-hidden strokeWidth={3.2} className="size-3" />
                </span>
              ) : null}
              {render(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
