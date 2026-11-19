import { composeLayout, encodeQr, renderQrSvg, type EyeBallShape, type EyeFrameShape, type QrStyle } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, QrPreview } from "@/entities/qr";
import { renderPixels } from "../../../packages/qr-core/test/pixel-probe";

/*
 * HEY-31: finder shapes. Per the handoff the corner frame and corner center are separate settings (eyeFrame, eyeBall)
 * with Square, Rounded and Circle; this covers the two non-square targets, Rounded and Circle. Frame and centre get
 * their own colours so their pixels can be told apart from each other and from the data modules.
 */
const QUIET = 4;
const PX = 20;
const FG = "#0D0D12";
const BG = "#FFFFFF";
const EYE = "#4B2EE0";
const EYE_IN = "#C8643B";
const VALUE = "https://littlefern.cafe/menu?table=4";
const m = encodeQr(VALUE, "M");
const n = m.size;
const V = n + 2 * QUIET;
const style = (eyeFrame: EyeFrameShape, eyeBall: EyeBallShape): QrStyle => ({
  pattern: "dot",
  eyeFrame,
  eyeBall,
  colors: { fg: FG, eye: EYE, eyeIn: EYE_IN, bg: BG },
});
/** Top-left module of each finder, in viewBox units. */
const FINDERS = [
  [QUIET, QUIET],
  [QUIET + n - 7, QUIET],
  [QUIET, QUIET + n - 7],
] as const;

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** Per pixel: "eye" (frame colour, incl. its antialiasing), "in" (centre colour), "fg", "bg" — at PX px per module. */
function classify(svg: string) {
  const img = renderPixels(svg, V * PX);
  const b = hex(BG);
  // An antialiased edge pixel is a blend of one ink with the background: pick the ink whose blend line explains it best.
  const inks: [string, number[]][] = [
    ["eye", hex(EYE)],
    ["in", hex(EYE_IN)],
    ["fg", hex(FG)],
  ];
  const out: string[] = [];
  for (let k = 0; k < img.width * img.height * 4; k += 4) {
    const px = [0, 1, 2].map((j) => img.data[k + j] ?? 0);
    if (Math.max(...px.map((v, j) => Math.abs(v - (b[j] ?? 0)))) <= 3) {
      out.push("bg");
      continue;
    }
    let best = "fg";
    let bestErr = Infinity;
    for (const [name, c] of inks) {
      const d = c.map((v, j) => v - (b[j] ?? 0));
      const t = Math.min(1, Math.max(0, d.reduce((a, v, j) => a + v * ((px[j] ?? 0) - (b[j] ?? 0)), 0) / d.reduce((a, v) => a + v * v, 0)));
      const err = Math.hypot(...px.map((v, j) => v - ((b[j] ?? 0) + t * (d[j] ?? 0))));
      if (err < bestErr) [best, bestErr] = [name, err];
    }
    out.push(best);
  }
  return { at: (x: number, y: number) => out[y * img.width + x] ?? "bg", width: img.width };
}
const inFinder = (px: number, py: number) =>
  FINDERS.some(([fx, fy]) => px >= fx * PX && px < (fx + 7) * PX && py >= fy * PX && py < (fy + 7) * PX);

const TARGETS: [EyeFrameShape, EyeBallShape][] = [
  ["rounded", "rounded"],
  ["circle", "circle"],
];

describe("Finder shapes: Rounded and Circle (HEY-31)", () => {
  it("are distinct, identical on all three finders, and stay inside the finder regions", () => {
    const masks = TARGETS.map(([frame, ball]) => {
      const svg = renderQrSvg(VALUE, style(frame, ball), 512);
      expect(renderQrSvg(VALUE, style(frame, ball), 512)).toBe(svg);
      const p = classify(svg);
      // No frame or centre colour outside the three 7×7 finder regions (separators, quiet zone and data untouched).
      const stray: string[] = [];
      for (let y = 0; y < V * PX; y++)
        for (let x = 0; x < V * PX; x++) if ((p.at(x, y) === "eye" || p.at(x, y) === "in") && !inFinder(x, y)) stray.push(`${x},${y}`);
      expect(stray.slice(0, 5)).toEqual([]);
      // Same shape, same orientation in every corner: compare the three 7×7 regions pixel by pixel.
      const region = ([fx, fy]: readonly [number, number]) =>
        Array.from({ length: 7 * PX * 7 * PX }, (_, k) => p.at(fx * PX + (k % (7 * PX)), fy * PX + Math.floor(k / (7 * PX)))).join("");
      const regions = FINDERS.map(region);
      expect(new Set(regions).size).toBe(1);
      // Ring, gap and centre at the finder's 1 : 1 : 3 : 1 : 1 positions (module centres along the middle row).
      const row = (mod: number) => p.at(FINDERS[0][0] * PX + mod * PX + PX / 2, FINDERS[0][1] * PX + 3.5 * PX);
      expect([0, 1, 2, 3, 4, 5, 6].map(row)).toEqual(["eye", "bg", "in", "in", "in", "bg", "eye"]);
      return regions[0];
    });
    expect(masks[0]).not.toBe(masks[1]);
  });

  it("frame and centre are independent: each setting changes only its own geometry", () => {
    const pixels = (frame: EyeFrameShape, ball: EyeBallShape) => {
      const p = classify(renderQrSvg(VALUE, style(frame, ball), 512));
      const all = Array.from({ length: V * PX * V * PX }, (_, k) => p.at(k % (V * PX), Math.floor(k / (V * PX))));
      return {
        frame: all.map((c) => (c === "eye" ? 1 : 0)).join(""),
        centre: all.map((c) => (c === "in" ? 1 : 0)).join(""),
        rest: all.map((c) => (c === "fg" ? 1 : 0)).join(""),
      };
    };
    const base = pixels("rounded", "rounded");
    const frameOnly = pixels("circle", "rounded");
    const centreOnly = pixels("rounded", "circle");
    expect(frameOnly.frame).not.toBe(base.frame);
    expect(frameOnly.centre).toBe(base.centre);
    expect(centreOnly.centre).not.toBe(base.centre);
    expect(centreOnly.frame).toBe(base.frame);
    // Data and function modules are the same in all three.
    expect(new Set([base.rest, frameOnly.rest, centreOnly.rest]).size).toBe(1);
    // In the SVG, only the frame path or only the centre path changes.
    const paths = (frame: EyeFrameShape, ball: EyeBallShape) => {
      const svg = renderQrSvg(VALUE, style(frame, ball), 512);
      return {
        frame: svg.match(new RegExp(`<path d="[^"]+" fill="${EYE}"[^>]*/>`))?.[0],
        centre: svg.match(new RegExp(`<path d="[^"]+" fill="${EYE_IN}"/>`))?.[0],
      };
    };
    expect(paths("circle", "rounded").centre).toBe(paths("rounded", "rounded").centre);
    expect(paths("rounded", "circle").frame).toBe(paths("rounded", "rounded").frame);
  });

  for (const [frame, ball] of [...TARGETS, ["circle", "rounded"], ["rounded", "circle"]] as [EyeFrameShape, EyeBallShape][])
    it(`editor preview and exported SVG agree · frame ${frame}, centre ${ball}`, () => {
      const layout = designToLayout({ ...DEFAULT_DESIGN, eyeFrame: frame, eyeBall: ball, preset: "caption", caption: "Scan me" });
      expect(layout.style).toMatchObject({ eyeFrame: frame, eyeBall: ball });
      const exported = composeLayout(layout, VALUE).svg; // what /api/export returns for format=svg
      const preview = renderToStaticMarkup(<QrPreview layout={layout} value={VALUE} label="Preview" />);
      // The preview is the exported SVG, only resized to its container.
      expect(preview).toContain(exported.replace(/\swidth="[^"]*"\s+height="[^"]*"/, ' width="100%" height="100%"'));
    });

  for (const [frame, ball] of TARGETS)
    it(`frame ${frame}, centre ${ball}: rasterized through the production path at two sizes, decodes to the exact payload`, async () => {
      const layout = designToLayout({
        ...DEFAULT_DESIGN,
        pattern: "dot",
        eyeFrame: frame,
        eyeBall: ball,
        preset: "caption",
        caption: "Scan me",
      });
      const { svg, width } = composeLayout(layout, VALUE);
      expect(composeLayout(layout, VALUE).svg).toBe(svg);
      for (const px of [Math.round(width), Math.round(width * 3)])
        expect(await decodeImage(rasterizeSvg(svg, { width: px })), `${px}px`).toBe(VALUE);
    });

  it("the default stays Rounded frame and Rounded centre", () => {
    expect([DEFAULT_DESIGN.eyeFrame, DEFAULT_DESIGN.eyeBall]).toEqual(["rounded", "rounded"]);
  });
});
