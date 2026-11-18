import { composeLayout, encodePayload, encodeQr, renderQrSvg, type Layout, type QrStyle } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, FRAME_STYLES } from "@/entities/qr";
import { renderPixels } from "../../../packages/qr-core/test/pixel-probe";

/*
 * HEY-27: the 4-module quiet zone around the matrix, measured on the rendered pixels of the final SVG (not inferred
 * from a successful decode). From each matrix edge we walk outward along every row/column of the matrix span until the
 * first pixel that isn't the symbol background (a frame stroke, caption, decoration, a hole) or the image edge (the
 * clipping boundary). The smallest such distance per side, in modules, must be at least 4.
 */
const QUIET = 4;
/** Antialiasing at the matrix edge and at the next mark can cost at most a fraction of a module. */
const TOLERANCE = 0.2;

type Side = "top" | "right" | "bottom" | "left";
type Gaps = Record<Side, number>;

function hex(c: string) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

/**
 * Gap in modules from each matrix edge to the nearest pixel that is not the quiet-zone colour.
 * `transparent`: the quiet zone must be see-through (alpha ≈ 0) instead of the background colour.
 */
function measureGaps(
  svg: string,
  opts: { bg: string; transparent?: boolean; scale?: number; widthPx?: number },
): Gaps & { modulePx: number } {
  const outer = svg.match(/^<svg [^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const canvasW = Number(outer?.[1]);
  // Standalone symbol: the outer svg is the symbol. In a layout: the nested <svg x y width height viewBox>.
  const nested = svg.match(/<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+" viewBox="0 0 (\d+) \d+">/);
  const [sx, sy, sw, v] = nested ? nested.slice(1, 5).map(Number) : [0, 0, canvasW, canvasW];
  const size = (v as number) - 2 * QUIET;
  const scale = opts.scale ?? 4;
  const img = renderPixels(svg, opts.widthPx ?? Math.round(canvasW * scale));
  const k = img.width / canvasW;
  const modulePx = ((sw as number) / (v as number)) * k;
  const m0x = ((sx as number) + ((sw as number) / (v as number)) * QUIET) * k;
  const m0y = ((sy as number) + ((sw as number) / (v as number)) * QUIET) * k;
  const m1x = m0x + size * modulePx;
  const m1y = m0y + size * modulePx;
  const [br, bgG, bb] = hex(opts.bg);
  const isZone = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    const [r, g, b, a] = [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0];
    if (opts.transparent) return a <= 8;
    return a >= 250 && Math.abs(r - (br ?? 0)) <= 10 && Math.abs(g - (bgG ?? 0)) <= 10 && Math.abs(b - (bb ?? 0)) <= 10;
  };
  const walk = (start: number, step: number, limit: number, at: (t: number) => boolean) => {
    let t = start;
    while (t >= 0 && t < limit && at(t)) t += step;
    return Math.abs(t - start);
  };
  const lo = (n: number) => Math.ceil(n) + 1;
  const hi = (n: number) => Math.floor(n) - 1;
  let top = Infinity;
  let bottom = Infinity;
  let left = Infinity;
  let right = Infinity;
  for (let x = lo(m0x); x <= hi(m1x); x++) {
    top = Math.min(top, walk(Math.floor(m0y) - 1, -1, img.height, (y) => isZone(x, y)) + (m0y - Math.floor(m0y)));
    bottom = Math.min(bottom, walk(Math.ceil(m1y), 1, img.height, (y) => isZone(x, y)) + (Math.ceil(m1y) - m1y));
  }
  for (let y = lo(m0y); y <= hi(m1y); y++) {
    left = Math.min(left, walk(Math.floor(m0x) - 1, -1, img.width, (x) => isZone(x, y)) + (m0x - Math.floor(m0x)));
    right = Math.min(right, walk(Math.ceil(m1x), 1, img.width, (x) => isZone(x, y)) + (Math.ceil(m1x) - m1x));
  }
  const toModules = (px: number) => Math.round((px / modulePx) * 100) / 100;
  return { top: toModules(top), right: toModules(right), bottom: toModules(bottom), left: toModules(left), modulePx };
}

const expectQuietZone = (g: Gaps) => {
  for (const side of ["top", "right", "bottom", "left"] as const) expect(g[side], side).toBeGreaterThanOrEqual(QUIET - TOLERANCE);
};

const SMALL = encodePayload({ type: "website", url: "littlefern.cafe/menu" }); // version 3, 29 modules
const LARGE = "x".repeat(666); // version 20, 97 modules
const STANDALONE: QrStyle = {
  pattern: "dot",
  eyeFrame: "circle",
  eyeBall: "leaf",
  colors: { fg: "#1F5C45", eye: "#1F5C45", eyeIn: "#8C2F4B", bg: "#FFFFFF" },
};

/** Decorated layouts: every frame style with a two-line caption, plus caption-only above and below the code. */
const DECORATED: [string, Layout][] = [
  ...FRAME_STYLES.map(
    (frameStyle) =>
      [
        `frame ${frameStyle}`,
        designToLayout({
          ...DEFAULT_DESIGN,
          preset: "frame",
          frameStyle,
          caption: "Scan for the menu\nTable 4",
          pattern: "fluid",
          eyeFrame: "cushion",
        }),
      ] as [string, Layout],
  ),
  ["caption below", designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "See the menu", pattern: "leaf" })],
  [
    "caption above",
    (() => {
      const l = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "See the menu", pattern: "vbars" });
      return { ...l, caption: { ...l.caption, position: "before" as const } };
    })(),
  ],
];

describe("Quiet zone (HEY-27)", () => {
  for (const [name, value] of [
    ["smaller matrix", SMALL],
    ["larger matrix", LARGE],
  ] as const)
    it(`standalone symbol · ${name}: 4 modules on every side, at two output sizes`, () => {
      expect(renderQrSvg(value, STANDALONE, 512)).toBe(renderQrSvg(value, STANDALONE, 512));
      for (const px of [256, 2048]) {
        const g = measureGaps(renderQrSvg(value, STANDALONE, px), { bg: "#FFFFFF", widthPx: px });
        expect(g.modulePx).toBeCloseTo(px / (encodeQr(value, "M").size + 2 * QUIET), 5);
        expectQuietZone(g);
        // Standalone, the quiet zone runs exactly to the image edge (the clipping boundary).
        for (const side of ["top", "right", "bottom", "left"] as const) expect(g[side]).toBeLessThanOrEqual(QUIET + TOLERANCE);
      }
    });

  for (const [name, layout] of DECORATED)
    for (const [size, value] of [
      ["smaller", SMALL],
      ["larger", LARGE],
    ] as const)
      it(`${name} · ${size} matrix: nothing in the composed SVG reaches into the quiet zone`, () => {
        const first = composeLayout(layout, value).svg;
        expect(composeLayout(layout, value).svg).toBe(first);
        expectQuietZone(measureGaps(first, { bg: layout.colors.bg }));
      });

  for (const [name, layout] of DECORATED)
    it(`transparent export · ${name}: the quiet zone stays see-through, with no frame colour or marks`, () => {
      const svg = composeLayout(layout, SMALL, { transparent: true }).svg;
      expect(composeLayout(layout, SMALL, { transparent: true }).svg).toBe(svg);
      expectQuietZone(measureGaps(svg, { bg: layout.colors.bg, transparent: true }));
    });

  it("a decorated layout rasterized through the production path decodes to the exact payload", async () => {
    const layout = designToLayout({
      ...DEFAULT_DESIGN,
      preset: "frame",
      frameStyle: "ticket",
      caption: "Scan for the menu\nTable 4",
      fg: "#4B2EE0",
      pattern: "rounded",
      eyeFrame: "circle",
      eyeBall: "diamond",
      logo: { kind: "icon", icon: "coffee" },
    });
    const value = encodePayload({ type: "website", url: "littlefern.cafe/menu?table=4" });
    const { svg, width } = composeLayout(layout, value);
    expectQuietZone(measureGaps(svg, { bg: layout.colors.bg }));
    expect(await decodeImage(rasterizeSvg(svg, { width: Math.round(width * 2) }))).toBe("https://littlefern.cafe/menu?table=4");
  });

  it("a transparent framed export placed on white decodes to the exact payload", async () => {
    const layout = designToLayout({ ...DEFAULT_DESIGN, preset: "frame", frameStyle: "bubble", caption: "Scan me", fg: "#0D0D12" });
    const value = encodePayload({ type: "text", text: "  Привет ☕\n\nLine 3 " });
    const { svg, width } = composeLayout(layout, value, { transparent: true });
    const png = rasterizeSvg(svg, { width: Math.round(width * 2), background: "#FFFFFF" });
    expect(await decodeImage(png)).toBe("  Привет ☕\n\nLine 3 ");
  });

  it("measures what it claims: a mark inside the quiet zone is detected", () => {
    // Sanity check of the probe: a bar 2 modules left of the matrix must show up as a 2-module gap.
    const svg = renderQrSvg(SMALL, STANDALONE, 512).replace("</svg>", '<rect x="1.5" y="10" width="0.5" height="5" fill="#000000"/></svg>');
    const g = measureGaps(svg, { bg: "#FFFFFF" });
    expect(g.left).toBeGreaterThan(1.7);
    expect(g.left).toBeLessThan(2.3);
    expect(encodeQr(SMALL, "M").size).toBe(29);
  });
});
