import { createRequire } from "node:module";
import { renderQr } from "@heyqr/qr-core";
import { describe, expect, it } from "vitest";
import { EYE_BALL_SHAPES, EYE_FRAME_SHAPES } from "@/entities/qr";
import { FINDER_CROP } from "./shape-thumb";

// The renderer's own rasterizer, from qr-core's dependencies (pnpm doesn't hoist it to the app).
type Rendered = { width: number; height: number; pixels: Uint8Array };
type ResvgCtor = new (svg: string, options: { fitTo: { mode: "width"; value: number } }) => { render(): Rendered };
const { Resvg } = createRequire(new URL("../../../packages/qr-core/package.json", import.meta.url))("@resvg/resvg-js") as {
  Resvg: ResvgCtor;
};

/*
 * HEY-187: Pattern → Corner frame / Corner center thumbnails drew the finder cropped at 3.4 + 7.2 = 10.6 modules while
 * the finder ends at 11, so every shape lost its right and bottom edge. The crop must hold the whole finder of every
 * shape with room to spare: no ink may touch the thumbnail's edge.
 */
function edgeInk(frame: (typeof EYE_FRAME_SHAPES)[number], ball: (typeof EYE_BALL_SHAPES)[number]) {
  const r = renderQr("HEY", {
    pattern: "square",
    eyeFrame: frame,
    eyeBall: ball,
    colors: { fg: "transparent", eye: "#000000", eyeIn: "#000000", bg: "transparent" },
  });
  const { x, y, size } = FINDER_CROP;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}" width="164" height="164">${r.inner}</svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: 164 } }).render();
  const { width, height, pixels } = img;
  let hits = 0;
  for (let i = 0; i < width; i++)
    for (const j of [0, 1, height - 2, height - 1]) {
      if ((pixels[(j * width + i) * 4 + 3] ?? 0) > 0) hits++;
      if ((pixels[(i * width + j) * 4 + 3] ?? 0) > 0) hits++;
    }
  return hits;
}

describe("corner frame and center thumbnails (HEY-187)", () => {
  it("the crop holds the finder (modules 4–11) with at least half a module on every side", () => {
    expect(FINDER_CROP.x).toBeLessThanOrEqual(4 - 0.5);
    expect(FINDER_CROP.x + FINDER_CROP.size).toBeGreaterThanOrEqual(11 + 0.5);
    expect(FINDER_CROP.x + FINDER_CROP.size - 11).toBeCloseTo(4 - FINDER_CROP.x, 5);
  });

  for (const frame of EYE_FRAME_SHAPES)
    it(`no ink reaches the thumbnail edge: frame ${frame} with every center`, () => {
      for (const ball of EYE_BALL_SHAPES) expect(edgeInk(frame, ball), `${frame} / ${ball}`).toBe(0);
    });
});
