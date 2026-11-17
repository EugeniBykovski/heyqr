import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/** Design "Skeleton": ink-150 fill with a 1.5 s left-to-right sheen; static fill with reduced motion. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "relative shrink-0 overflow-hidden rounded-sm bg-skeleton",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-skeleton-highlight after:to-transparent motion-reduce:after:hidden",
        className,
      )}
      {...props}
    />
  );
}
