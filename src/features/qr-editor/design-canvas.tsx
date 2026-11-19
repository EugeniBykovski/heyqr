"use client";

import type { Layout } from "@heyqr/qr-core";
import { LoaderCircleIcon } from "lucide-react";
import { memo, useDeferredValue } from "react";
import { QrPreview, useCaptionFontsReady } from "@/entities/qr";
import { cn } from "@/shared/lib/utils";
import { useDelayedFlag } from "@/shared/lib/use-delayed-flag";

/** Re-renders only when the layout or value it shows changes, so an urgent settings update never redraws it. */
const RenderedPreview = memo(QrPreview);

/**
 * The settings the canvas shows: the latest ones once rendered, the previous ones while a newer render is in progress
 * (React-deferred). React abandons a deferred render that newer settings overtake, so the newest render always wins.
 */
export function useShownRender(layout: Layout, value: string): { layout: Layout; value: string; rebuilding: boolean } {
  const shownLayout = useDeferredValue(layout);
  const shownValue = useDeferredValue(value);
  return { layout: shownLayout, value: shownValue, rebuilding: shownLayout !== layout || shownValue !== value };
}

/** How long a rebuild may take before the progress pill appears; quicker rebuilds show nothing. */
export const REBUILD_PILL_DELAY_MS = 150;

/*
 * Design 5.2 / 5.3: the canvas art. It shows the last finished render (`layout`/`value` from useShownRender)
 * while a newer one is built, with a status pill over the art that takes no layout space. React drops a deferred
 * render that newer settings overtake, so an older render can never replace the latest one.
 */
export function DesignCanvas({
  layout,
  value,
  rebuilding,
  label,
  tooLongLabel,
  watermark,
  updatingLabel,
}: {
  layout: Layout;
  value: string;
  /** Newer settings than the ones shown are being rendered. */
  rebuilding: boolean;
  label: string;
  tooLongLabel: string;
  watermark: string;
  updatingLabel: string;
}) {
  // HEY-44: until the caption's font faces have loaded the caption stays hidden and the canvas counts as updating, so
  // a stand-in font is never shown as the final look.
  const fontsReady = useCaptionFontsReady(layout);
  const busy = rebuilding || !fontsReady;
  const showPill = useDelayedFlag(busy, REBUILD_PILL_DELAY_MS);
  return (
    <div
      className={cn("relative size-full", !fontsReady && "[&_text]:invisible")}
      aria-busy={busy || undefined}
      data-caption-fonts={fontsReady ? "ready" : "loading"}
    >
      <RenderedPreview layout={layout} value={value} label={label} tooLongLabel={tooLongLabel} className="size-full" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 grid -rotate-30 place-items-center text-h1 font-bold tracking-[0.3em] text-foreground/7 uppercase"
      >
        {watermark}
      </span>
      {showPill ? (
        <span
          aria-hidden
          data-slot="rebuild-pill"
          className="absolute top-3 left-1/2 z-2 inline-flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 animate-fade items-center gap-2 truncate rounded-full bg-inverse py-1.5 pr-3 pl-2.5 text-[0.8125rem] font-semibold whitespace-nowrap text-inverse-foreground shadow-2"
        >
          <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          {updatingLabel}
        </span>
      ) : null}
      {/* One polite message, present before it changes so screen readers announce it. */}
      <span role="status" className="sr-only">
        {showPill ? updatingLabel : ""}
      </span>
    </div>
  );
}
