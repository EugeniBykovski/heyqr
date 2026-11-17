import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "stage": the canvas the QR sits on. A 28 px card (20 px inside the editor) with an 18 px dot grid,
 * a translucent top bar, a centred art area whose height is set per breakpoint, and a white footer.
 */
export function Stage({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stage"
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-border bg-stage",
        "bg-[radial-gradient(var(--color-stage-dot)_1px,transparent_1.3px)] bg-size-[18px_18px]",
        className,
      )}
      {...props}
    />
  );
}

export function StageBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-bar"
      className={cn("flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-surface/88 p-2", className)}
      {...props}
    />
  );
}

/**
 * Centred art area. `height` is the canvas height (a CSS length, may be a clamp() or a custom property);
 * the art keeps its aspect ratio inside it, so swapping a skeleton for the preview never shifts the layout.
 */
export function StageCanvas({ height, className, style, children, ...props }: ComponentProps<"div"> & { height?: string }) {
  return (
    <div
      data-slot="stage-canvas"
      style={{ ...(height ? { "--stage-canvas-h": height } : null), ...style } as CSSProperties}
      className={cn(
        "relative grid h-(--stage-canvas-h,12.25rem) min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center overflow-hidden p-4 transition-[height] duration-(--motion-panel) ease-out",
        className,
      )}
      {...props}
    >
      <div className="aspect-square h-full max-h-full max-w-full drop-shadow-[0_14px_28px_rgb(13_13_18/0.14)]">{children}</div>
    </div>
  );
}

export function StageFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-foot"
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-surface px-3 py-2.5", className)}
      {...props}
    />
  );
}
