import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "stage": the canvas the QR sits on. A 28 px card (20 px inside the editor) with an 18 px dot grid,
 * a translucent top bar, a centred art area whose height is set per breakpoint, and a white footer.
 */
export type StageTone = "light" | "dark" | "checker";

export function Stage({ className, tone = "light", ...props }: ComponentProps<"div"> & { tone?: StageTone }) {
  return (
    <div
      data-slot="stage"
      data-tone={tone}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-border bg-stage",
        "bg-[radial-gradient(var(--color-stage-dot)_1px,transparent_1.3px)] bg-size-[18px_18px]",
        // Design 1.12 canvas background: a viewing preference only; it never changes the code or its files.
        "data-[tone=dark]:bg-ink-900 data-[tone=dark]:[--color-stage-dot:var(--color-ink-800)]",
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
 * `actual` shows the art at its real size (design 1.12 "Actual size"): the area scrolls instead of scaling it down.
 */
export function StageCanvas({
  height,
  actual,
  className,
  style,
  children,
  ...props
}: ComponentProps<"div"> & { height?: string; actual?: { width: string; height: string } }) {
  return (
    <div
      data-slot="stage-canvas"
      style={{ ...(height ? { "--stage-canvas-h": height } : null), ...style } as CSSProperties}
      className={cn(
        "relative grid h-(--stage-canvas-h,12.25rem) min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center p-4 transition-[height] duration-(--motion-panel) ease-out",
        actual ? "overflow-auto" : "overflow-hidden",
        // The transparent-export check: a light checkerboard behind the art.
        "in-data-[tone=checker]:bg-white in-data-[tone=checker]:bg-[conic-gradient(var(--color-ink-100)_25%,var(--color-white)_0_50%,var(--color-ink-100)_0_75%,var(--color-white)_0)] in-data-[tone=checker]:bg-size-[18px_18px]",
        className,
      )}
      {...props}
    >
      {actual ? (
        <div className="m-auto shrink-0" style={{ width: actual.width, height: actual.height }}>
          {children}
        </div>
      ) : (
        <div className="aspect-square h-full max-h-full max-w-full drop-shadow-[0_14px_28px_rgb(13_13_18/0.14)]">{children}</div>
      )}
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
