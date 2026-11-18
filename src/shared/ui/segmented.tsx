import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "segmented control" (seg / seg__opt): subtle pill track with a hairline border and a 3 px inset;
 * the selected option is a raised white segment, so selection never relies on colour alone.
 * Phones (< 600 px) use 16 / 12 px radii so wrapped options stay tidy.
 */
export const segmentedTrack = "flex w-full min-w-0 flex-wrap gap-0.75 rounded-lg border border-border bg-subtle p-0.75 sm:rounded-full";

export const segmentedOption = cn(
  "inline-flex min-h-9 min-w-0 flex-auto cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-label whitespace-nowrap text-secondary-foreground sm:rounded-full",
  "transition-[background-color,color,box-shadow] duration-(--motion-fast) hover:text-foreground",
  "aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-segment",
  "aria-[current=page]:bg-surface aria-[current=page]:text-foreground aria-[current=page]:shadow-segment",
  "disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4",
);

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; hint?: string };

/** Single-choice group of native buttons with aria-pressed (design: all choices are buttons). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  /** Selected option; undefined when none applies. */
  value: T | undefined;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} data-slot="segmented" className={cn(segmentedTrack, className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.hint}
          className={segmentedOption}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedTrack({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="segmented" className={cn(segmentedTrack, className)} {...props} />;
}
