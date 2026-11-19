"use client";

import { renderQr, type EyeBallShape, type EyeFrameShape, type ModuleShape } from "@heyqr/qr-core";
import { memo } from "react";

/** A short fixed payload: version 1, so a few modules make a readable crop. */
const SAMPLE = "HEY";
const INK = "currentColor";
const BG = "transparent";

type Part = { kind: "modules"; shape: ModuleShape } | { kind: "frame"; shape: EyeFrameShape } | { kind: "ball"; shape: EyeBallShape };

const cache = new Map<string, { viewBox: string; inner: string }>();

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
  const viewBox = part.kind === "modules" ? "11 11 7 7" : part.kind === "frame" ? "3.4 3.4 7.2 7.2" : "5.2 5.2 3.6 3.6";
  const out = { viewBox, inner: r.inner };
  cache.set(key, out);
  return out;
}

/*
 * Design 1.7: each Pattern option shows exactly which part it changes, drawn by qr-core from the supported renderer
 * values (no hand-drawn look-alikes). Decorative: the option's text label names it.
 */
export const ShapeThumb = memo(function ShapeThumb({ part, className }: { part: Part; className?: string }) {
  const { viewBox, inner } = art(part);
  return <svg aria-hidden viewBox={viewBox} className={className} dangerouslySetInnerHTML={{ __html: inner }} />;
});
