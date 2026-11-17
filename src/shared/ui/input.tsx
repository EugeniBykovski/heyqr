import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Design "Field" control: 44 px, 12 px radius, 16 px text (no iOS zoom), control border at 3.3:1.
 * Hover darkens the border; focus is a violet border with a 3 px violet-100 halo; errors use the danger border and halo.
 */
export const fieldControl = [
  "w-full min-w-0 rounded-md border border-input bg-surface px-3 py-2.5 text-[1rem] leading-[1.3] text-foreground",
  "transition-[border-color,box-shadow] duration-(--motion-fast) outline-none scroll-mt-35 scroll-mb-40",
  "placeholder:text-muted-foreground hover:border-input-hover",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring-soft",
  "aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger-soft",
  "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted-foreground disabled:hover:border-input",
].join(" ");

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldControl, "min-h-control", className)} {...props} />;
}

/** Design "affix": a fixed prefix (e.g. https://) joined to the input that follows it. */
export function InputPrefix({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="input-prefix"
      className={cn(
        "flex shrink-0 items-center rounded-l-md border border-r-0 border-input bg-subtle px-2.5 text-[0.875rem] whitespace-nowrap text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}
