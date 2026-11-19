import { composeLayout, encodePayload, encodeQr, renderQrSvg, type QrStyle } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { probeCells } from "../../../packages/qr-core/test/cell-probe";

/*
 * HEY-28: square modules, checked on rendered pixels against the input matrix (so it doesn't matter whether the
 * renderer emits rects or one combined path). At an integer number of pixels per module every module boundary falls
 * on a pixel boundary, so a correct square module colours every pixel of its cell and nothing outside it.
 */
const QUIET = 4;
const FG = "#0D0D12";
const BG = "#FFFFFF";
const SQUARE: QrStyle = { pattern: "square", eyeFrame: "square", eyeBall: "square", colors: { fg: FG, eye: FG, eyeIn: FG, bg: BG } };
const VALUE = encodePayload({ type: "website", url: "littlefern.cafe/menu?table=4" });

/** Colour class of every pixel in each module cell (quiet zone included): "fg", "bg" or "mixed". */
function cellClasses(svg: string, viewBox: number, pxPerModule: number) {
  const probe = probeCells(svg, viewBox, pxPerModule, { fg: FG, bg: BG });
  expect(probe.width).toBe(viewBox * pxPerModule);
  return (cx: number, cy: number) => probe.cell(cx, cy).kind;
}

describe("Square modules (HEY-28)", () => {
  const m = encodeQr(VALUE, "M");
  const n = m.size;
  const V = n + 2 * QUIET;
  const dark = (x: number, y: number) => m.modules[y]?.[x] === true;

  for (const pxPerModule of [3, 10])
    it(`every cell matches the matrix exactly at ${pxPerModule} px per module (corners, joins, light cells, quiet zone)`, () => {
      const cell = cellClasses(renderQrSvg(VALUE, SQUARE, V * pxPerModule), V, pxPerModule);
      const mismatches: string[] = [];
      for (let cy = 0; cy < V; cy++)
        for (let cx = 0; cx < V; cx++) {
          const x = cx - QUIET;
          const y = cy - QUIET;
          const want = x >= 0 && y >= 0 && x < n && y < n && dark(x, y) ? "fg" : "bg";
          const got = cell(cx, cy);
          if (got !== want) mismatches.push(`(${x},${y}) ${got}≠${want}`);
        }
      expect(mismatches).toEqual([]);
    });

  it("covers the cases that matter: adjacent dark pairs, an isolated dark cell and light cells between dark ones", () => {
    const cell = cellClasses(renderQrSvg(VALUE, SQUARE, V * 10), V, 10);
    const at = (x: number, y: number) => cell(x + QUIET, y + QUIET);
    const inner = (x: number, y: number) => x > 8 && y > 8 && x < n - 9 && y < n - 9; // away from finders
    const cells = Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)] as const).filter(([x, y]) => inner(x, y));
    const hPair = cells.find(([x, y]) => dark(x, y) && dark(x + 1, y));
    const vPair = cells.find(([x, y]) => dark(x, y) && dark(x, y + 1));
    const isolated = cells.find(([x, y]) => dark(x, y) && !dark(x - 1, y) && !dark(x + 1, y) && !dark(x, y - 1) && !dark(x, y + 1));
    const lightBetween = cells.find(([x, y]) => !dark(x, y) && dark(x - 1, y) && dark(x + 1, y));
    expect([hPair, vPair, isolated, lightBetween].every(Boolean)).toBe(true);
    const [hx, hy] = hPair ?? [0, 0];
    const [vx, vy] = vPair ?? [0, 0];
    const [ix, iy] = isolated ?? [0, 0];
    const [lx, ly] = lightBetween ?? [0, 0];
    // Adjacent dark cells are solid across the shared edge (no hairline gap), on both axes.
    expect([at(hx, hy), at(hx + 1, hy), at(vx, vy), at(vx, vy + 1)]).toEqual(["fg", "fg", "fg", "fg"]);
    // An isolated dark cell is a full square with sharp corners; its four light neighbours stay empty.
    expect([at(ix, iy), at(ix - 1, iy), at(ix + 1, iy), at(ix, iy - 1), at(ix, iy + 1)]).toEqual(["fg", "bg", "bg", "bg", "bg"]);
    // A light cell between two dark ones gets no foreground bleed.
    expect([at(lx - 1, ly), at(lx, ly), at(lx + 1, ly)]).toEqual(["fg", "bg", "fg"]);
  });

  it("other eye shapes leave square data modules and the finder areas untouched", () => {
    const style: QrStyle = { ...SQUARE, eyeFrame: "circle", eyeBall: "leaf" };
    const cell = cellClasses(renderQrSvg(VALUE, style, V * 10), V, 10);
    const eye = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    const wrong: string[] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (eye(x, y)) continue;
        const got = cell(x + QUIET, y + QUIET);
        if (got !== (dark(x, y) ? "fg" : "bg")) wrong.push(`(${x},${y})`);
      }
    expect(wrong).toEqual([]);
  });

  it("renders byte-identically, and the output size changes only width/height", () => {
    expect(renderQrSvg(VALUE, SQUARE, 512)).toBe(renderQrSvg(VALUE, SQUARE, 512));
    const strip = (s: string) => s.replace(/ width="\d+" height="\d+"/, "");
    const small = renderQrSvg(VALUE, SQUARE, 3 * V);
    const large = renderQrSvg(VALUE, SQUARE, 10 * V);
    expect(strip(small)).toBe(strip(large));
    expect(small).toContain(`viewBox="0 0 ${V} ${V}"`);
  });

  it("a square-style layout rasterized through the production path decodes to the exact payload", async () => {
    const layout = designToLayout({
      ...DEFAULT_DESIGN,
      pattern: "square",
      eyeFrame: "square",
      eyeBall: "square",
      preset: "caption",
      caption: "Scan me",
    });
    const first = composeLayout(layout, VALUE);
    expect(composeLayout(layout, VALUE).svg).toBe(first.svg);
    for (const scale of [1, 3])
      expect(await decodeImage(rasterizeSvg(first.svg, { width: Math.round(first.width * scale) }))).toBe(
        "https://littlefern.cafe/menu?table=4",
      );
  });
});
