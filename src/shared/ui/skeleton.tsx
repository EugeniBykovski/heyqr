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

/**
 * For the root of a loading view (HEY-41): its boxes are laid out from the first frame, so nothing shifts, but they
 * appear only after 200 ms; a load that finishes sooner shows no skeleton at all. Reduced motion skips the fade.
 */
export const skeletonReveal = "animate-skeleton-in";

/** A quiet empty-state shape: the skeleton's fill without the sheen (design "ph"). */
export function Placeholder({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="placeholder" aria-hidden className={cn("block shrink-0 rounded-full bg-skeleton", className)} {...props} />;
}

/** One line of text while loading: the line box of the given type role (`className`), with a bar inside it. */
export function SkeletonText({ className, barClassName }: { className?: string; barClassName?: string }) {
  return (
    <span aria-hidden className={cn("flex h-[1lh] items-center", className)}>
      <Skeleton className={cn("h-[0.7em] w-full rounded-full", barClassName)} />
    </span>
  );
}

/**
 * Text whose copy is known while loading (fixed labels): the real words reserve exactly their space, line wraps included,
 * but stay invisible and out of the accessibility tree; a bar marks the first line.
 */
export function SkeletonGhostText({ text, className, barClassName }: { text: string; className?: string; barClassName?: string }) {
  return (
    <span aria-hidden className={cn("relative", className)}>
      <span className="invisible">{text}</span>
      <Skeleton className={cn("absolute start-0 top-[0.15lh] h-[0.7lh] w-full rounded-full", barClassName)} />
    </span>
  );
}
