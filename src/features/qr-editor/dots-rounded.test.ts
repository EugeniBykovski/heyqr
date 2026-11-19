import { composeLayout, encodePayload, encodeQr, renderQrSvg, type ModuleShape, type QrStyle } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { probeCells } from "../../../packages/qr-core/test/cell-probe";

/*
 * HEY-29: Dots (a circle centred in each dark data cell) and Rounded (a square module with rounded corners), checked on
 * rendered pixels against the input matrix, next to Square (HEY-28). At 20 px per module a cell is 20 × 20 pixels.
 */
const QUIET = 4;
const PX = 20;
const FG = "#0D0D12";
const BG = "#FFFFFF";
const EYE = "#4B2EE0";
const EYE_IN = "#8C2F4B";
const style = (pattern: ModuleShape): QrStyle => ({
  pattern,
  eyeFrame: "rounded",
  eyeBall: "circle",
  colors: { fg: FG, eye: EYE, eyeIn: EYE_IN, bg: BG },
});
const VALUE = encodePayload({ type: "website", url: "littlefern.cafe/menu?table=4" });
const m = encodeQr(VALUE, "M");
const n = m.size;
const V = n + 2 * QUIET;
const dark = (x: number, y: number) => m.modules[y]?.[x] === true;
const inEye = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
const probe = (pattern: ModuleShape) => probeCells(renderQrSvg(VALUE, style(pattern), V * PX), V, PX, { fg: FG, bg: BG });

const dataCells = Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)] as const).filter(([x, y]) => !inEye(x, y));
const away = ([x, y]: readonly [number, number]) => x > 8 && y > 8 && x < n - 9 && y < n - 9;
const isolated = dataCells.find(
  (c) => away(c) && dark(...c) && !dark(c[0] - 1, c[1]) && !dark(c[0] + 1, c[1]) && !dark(c[0], c[1] - 1) && !dark(c[0], c[1] + 1),
);
const pair = dataCells.find((c) => away(c) && dark(...c) && dark(c[0] + 1, c[1]));

describe("Dots and Rounded modules (HEY-29)", () => {
  it("the test matrix has an isolated dark cell and a horizontal dark pair", () => {
    expect(isolated && pair).toBeTruthy();
  });

  // [pattern, share of the cell drawn, centre, edge-middle, corner (1 px in), edge sample row]
  // Edge rows avoid pixels the shape edge runs through: dot r = 0.45 reaches 1 px from the edge, rounded starts 1.2 px in.
  const SHAPES: [ModuleShape, number, string, string, string, number][] = [
    ["square", 1, "fg", "fg", "fg", 0],
    ["dot", Math.PI * 0.45 ** 2, "fg", "bg", "bg", 0],
    ["rounded", 0.88 ** 2 - (4 - Math.PI) * 0.3 ** 2, "fg", "fg", "bg", 2],
  ];

  for (const [pattern, share, centre, edge, corner, edgeRow] of SHAPES)
    it(`${pattern}: an isolated dark cell is the intended shape and nothing leaves the cell`, () => {
      const p = probe(pattern);
      const [x, y] = isolated ?? [0, 0];
      const [cx, cy] = [x + QUIET, y + QUIET];
      const c = p.cell(cx, cy);
      // Drawn area matches the shape (antialiased edge pixels count half).
      expect((c.fg + (c.all - c.fg - c.bg) / 2) / c.all).toBeCloseTo(share, 1);
      expect(p.pixel(cx, cy, PX / 2, PX / 2)).toBe(centre);
      expect(p.pixel(cx, cy, PX / 2, edgeRow)).toBe(edge);
      expect(p.pixel(cx, cy, 1, 1)).toBe(corner);
      // Its four light neighbours get no foreground at all.
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const)
        expect(p.cell(cx + dx, cy + dy).kind).toBe("bg");
    });

  for (const [pattern, joined] of [
    ["square", true],
    ["dot", false],
    ["rounded", false],
  ] as const)
    it(`${pattern}: two adjacent dark cells are ${joined ? "one solid run" : "two separate modules"} and stay inside their cells`, () => {
      const p = probe(pattern);
      const [x, y] = pair ?? [0, 0];
      const [cx, cy] = [x + QUIET, y + QUIET];
      expect(p.pixel(cx, cy, PX / 2, PX / 2)).toBe("fg");
      expect(p.pixel(cx + 1, cy, PX / 2, PX / 2)).toBe("fg");
      // At the shared edge, halfway down: solid for square, a background gap for dots and rounded.
      expect([p.pixel(cx, cy, PX - 1, PX / 2), p.pixel(cx + 1, cy, 0, PX / 2)]).toEqual(joined ? ["fg", "fg"] : ["bg", "bg"]);
    });

  it("dots and rounded are visually distinct from each other and from square", () => {
    const masks = (["square", "dot", "rounded"] as const).map((pattern) => {
      const p = probe(pattern);
      const [x, y] = isolated ?? [0, 0];
      return Array.from({ length: PX * PX }, (_, i) => p.pixel(x + QUIET, y + QUIET, i % PX, Math.floor(i / PX))).join("");
    });
    expect(new Set(masks).size).toBe(3);
  });

  for (const pattern of ["dot", "rounded"] as const)
    it(`${pattern}: every light cell and the quiet zone stay empty; every dark data cell is drawn`, () => {
      const p = probe(pattern);
      const wrong: string[] = [];
      for (let cy = 0; cy < V; cy++)
        for (let cx = 0; cx < V; cx++) {
          const [x, y] = [cx - QUIET, cy - QUIET];
          const inMatrix = x >= 0 && y >= 0 && x < n && y < n;
          if (inMatrix && inEye(x, y)) continue; // finders are drawn by the eye shapes
          const c = p.cell(cx, cy);
          if (inMatrix && dark(x, y) ? c.fg === 0 : c.kind !== "bg") wrong.push(`(${x},${y})`);
        }
      expect(wrong).toEqual([]);
    });

  it("switching Square → Dots → Rounded keeps the viewBox, the quiet zone and the finder geometry", () => {
    const svgs = (["square", "dot", "rounded"] as const).map((pattern) => renderQrSvg(VALUE, style(pattern), 512));
    const finders = (svg: string) => [...svg.matchAll(/<path d="[^"]+" fill="(#4B2EE0|#8C2F4B)"[^>]*\/>/g)].map((x) => x[0]);
    for (const svg of svgs) {
      expect(svg).toContain(`viewBox="0 0 ${V} ${V}"`);
      expect(svg).toContain(`<rect width="${V}" height="${V}" fill="${BG}"/>`);
      expect(finders(svg)).toHaveLength(2);
      expect(finders(svg)).toEqual(finders(svgs[0] ?? ""));
    }
    expect(new Set(svgs).size).toBe(3);
  });

  for (const pattern of ["square", "dot", "rounded"] as const)
    it(`${pattern}: identical SVG on every render`, () => {
      expect(renderQrSvg(VALUE, style(pattern), 512)).toBe(renderQrSvg(VALUE, style(pattern), 512));
      const layout = designToLayout({ ...DEFAULT_DESIGN, pattern, preset: "caption", caption: "Scan me" });
      expect(composeLayout(layout, VALUE).svg).toBe(composeLayout(layout, VALUE).svg);
    });

  for (const pattern of ["dot", "rounded"] as const)
    it(`${pattern}: rasterized through the production path at two sizes, decodes to the exact payload`, async () => {
      const layout = designToLayout({ ...DEFAULT_DESIGN, pattern, preset: "caption", caption: "Scan me", fg: "#1F5C45" });
      const { svg, width } = composeLayout(layout, VALUE);
      for (const px of [Math.round(width), Math.round(width * 3)])
        expect(await decodeImage(rasterizeSvg(svg, { width: px })), `${pattern} @ ${px}px`).toBe("https://littlefern.cafe/menu?table=4");
    });
});
