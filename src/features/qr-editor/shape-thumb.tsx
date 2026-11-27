"use client";

import { renderQr, type EyeBallShape, type EyeFrameShape, type ModuleShape } from "@heyqr/qr-core";
import { memo } from "react";

/** A short fixed payload: version 1, so a few modules make a readable crop. */
const SAMPLE = "HEY";
const INK = "currentColor";
const BG = "transparent";

type Part = { kind: "modules"; shape: ModuleShape } | { kind: "frame"; shape: EyeFrameShape } | { kind: "ball"; shape: EyeBallShape };

const cache = new Map<string, { viewBox: string; inner: string }>();

/**
 * HEY-187: the finder crop. Quiet zone 4 modules + finder 7 modules, so the finder spans 4–11; the crop leaves 0.6
 * module on every side. It used to be 3.4 + 7.2 = 10.6, which cut the right and bottom 0.4 module off every corner
 * frame and center. Exported for the test that checks it against the finder's real bounds.
 */
export const FINDER_CROP = { x: 3.4, y: 3.4, size: 8.2 } as const;
const FINDER_VIEWBOX = `${FINDER_CROP.x} ${FINDER_CROP.y} ${FINDER_CROP.size} ${FINDER_CROP.size}`;

/** The renderer's own drawing of one option, cropped to the part it changes: data modules, or the top-left corner. */
function art(part: Part) {
  const key = `${part.kind}:${part.shape}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = renderQr(SAMPLE, {
    pattern: part.kind === "modules" ? part.shape : "square",
    eyeFrame: part.kind === "frame" ? part.shape : "square",
    eyeBall: part.kind === "ball" ? part.shape : "square",
    // The other parts are drawn transparent so the crop shows only the option.
    colors: {
      fg: part.kind === "modules" ? INK : BG,
      eye: part.kind === "frame" ? INK : BG,
      eyeIn: part.kind === "ball" ? INK : BG,
      bg: BG,
    },
  });
  // Quiet zone is 4 modules; the finder spans modules 4–10 of the viewBox. Data modules sit right of the finder.
  const viewBox = part.kind === "modules" ? "11 11 7 7" : part.kind === "frame" ? FINDER_VIEWBOX : "5.2 5.2 3.6 3.6";
  const out = { viewBox, inner: r.inner };
  cache.set(key, out);
  return out;
}

/** The whole top-left finder with only one of its parts in ink (the frame or the center), for layering. */
function finderPart(frame: EyeFrameShape, ball: EyeBallShape, ink: "frame" | "ball") {
  const key = `finder:${frame}:${ball}:${ink}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = renderQr(SAMPLE, {
    pattern: "square",
    eyeFrame: frame,
    eyeBall: ball,
    colors: { fg: BG, eye: ink === "frame" ? INK : BG, eyeIn: ink === "ball" ? INK : BG, bg: BG },
  });
  const out = { viewBox: FINDER_VIEWBOX, inner: r.inner };
  cache.set(key, out);
  return out;
}

/*
 * Design 1.7: each Pattern option shows exactly which part it changes, drawn by qr-core from the supported renderer
 * values (no hand-drawn look-alikes). Modules: a crop of data modules. Corner frame / center: the whole finder, the
 * part the option changes in the accent and the other part faint, so the finder's proportions stay visible.
 * Decorative: the option's text label names it.
 */
export const ShapeThumb = memo(function ShapeThumb({ part, className }: { part: Part; className?: string }) {
  if (part.kind === "modules") {
    const { viewBox, inner } = art(part);
    return <svg aria-hidden viewBox={viewBox} className={className} dangerouslySetInnerHTML={{ __html: inner }} />;
  }
  const frame: EyeFrameShape = part.kind === "frame" ? part.shape : "rounded";
  const ball: EyeBallShape = part.kind === "ball" ? part.shape : "rounded";
  const active = finderPart(frame, ball, part.kind === "frame" ? "frame" : "ball");
  const other = finderPart(frame, ball, part.kind === "frame" ? "ball" : "frame");
  return (
    <span aria-hidden className={`relative inline-block ${className ?? ""}`}>
      <svg
        viewBox={other.viewBox}
        className="absolute inset-0 size-full text-border-strong/25"
        dangerouslySetInnerHTML={{ __html: other.inner }}
      />
      <svg
        viewBox={active.viewBox}
        className="absolute inset-0 size-full text-accent-text"
        dangerouslySetInnerHTML={{ __html: active.inner }}
      />
    </span>
  );
});
