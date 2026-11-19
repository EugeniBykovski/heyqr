import { composeLayout, encodeQr, renderQrSvg, type ModuleShape, type QrStyle } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { probeCells } from "../../../packages/qr-core/test/cell-probe";

/*
 * HEY-30: Square, Dots and Rounded apply to data modules only. Function patterns stay plain squares whatever the style;
 * finder patterns keep their own eye settings. The function cells below are written from ISO/IEC 18004, not read from
 * the encoder's mask, so a wrong mask fails these tests too.
 */
const QUIET = 4;
const PX = 20;
const FG = "#0D0D12";
const BG = "#FFFFFF";
const STYLES: ModuleShape[] = ["square", "dot", "rounded"];
const style = (pattern: ModuleShape): QrStyle => ({
  pattern,
  eyeFrame: "circle",
  eyeBall: "leaf",
  colors: { fg: FG, eye: FG, eyeIn: FG, bg: BG },
});

type Cell = { x: number; y: number; dark: boolean; role: string };

/** Function cells per ISO/IEC 18004 for version `v` (outside the three 7×7 finders, which the eye shapes draw). */
function specFunctionCells(v: number, alignmentCentres: number[]): Cell[] {
  const n = 4 * v + 17;
  const cells: Cell[] = [];
  const add = (x: number, y: number, dark: boolean, role: string) => cells.push({ x, y, dark, role });
  // Separators: the light border just outside each finder.
  for (let i = 0; i < 8; i++) {
    add(7, i, false, "separator");
    add(i, 7, false, "separator");
    add(n - 8, i, false, "separator");
    add(n - 8 + i, 7, false, "separator");
    add(7, n - 8 + i, false, "separator");
    add(i, n - 8, false, "separator");
  }
  // Timing patterns: row 6 and column 6 between the separators, dark on even indices.
  for (let i = 8; i <= n - 9; i++) {
    add(i, 6, i % 2 === 0, "timing");
    add(6, i, i % 2 === 0, "timing");
  }
  // The dark module.
  add(8, 4 * v + 9, true, "dark module");
  // Alignment patterns: 5 × 5, dark ring, light ring, dark centre; none where a finder sits.
  for (const cy of alignmentCentres)
    for (const cx of alignmentCentres) {
      if ((cx < 9 && cy < 9) || (cx > n - 10 && cy < 9) || (cx < 9 && cy > n - 10)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) add(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, "alignment");
    }
  return cells;
}

/** Reserved cells whose colour depends on the data (format and version information): role only, no colour. */
function specInfoCells(v: number) {
  const n = 4 * v + 17;
  const cells: [number, number, string][] = [];
  for (const i of [0, 1, 2, 3, 4, 5, 7, 8]) cells.push([8, i, "format"], [i, 8, "format"]);
  for (let i = 0; i < 7; i++) cells.push([8, n - 1 - i, "format"]);
  for (let i = 0; i < 8; i++) cells.push([n - 1 - i, 8, "format"]);
  if (v >= 7) for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) cells.push([a, n - 11 + b, "version"], [n - 11 + b, a, "version"]);
  return cells;
}

const CASES = [
  // Version 1: 21 modules, no alignment pattern, no version information.
  { name: "version 1", value: "HeyQR v1", version: 1, alignment: [] as number[] },
  // Version 7: 45 modules, alignment centres 6/22/38, version information blocks.
  { name: "version 7", value: "x".repeat(110), version: 7, alignment: [6, 22, 38] },
];

describe("Function modules keep their shape (HEY-30)", () => {
  for (const c of CASES) {
    const m = encodeQr(c.value, "M");
    const n = m.size;
    const V = n + 2 * QUIET;
    const fixed = specFunctionCells(c.version, c.alignment);
    const info = specInfoCells(c.version);

    it(`${c.name}: the encoder's matrix and mask agree with the standard's function cells`, () => {
      expect([m.version, n]).toEqual([c.version, 4 * c.version + 17]);
      const wrong = fixed
        .filter((f) => m.functionModules[f.y]?.[f.x] !== true || m.modules[f.y]?.[f.x] !== f.dark)
        .map((f) => `${f.role} (${f.x},${f.y})`);
      expect(wrong).toEqual([]);
      expect(info.filter(([x, y]) => m.functionModules[y]?.[x] !== true)).toEqual([]);
      // A data cell far from every pattern is not in the mask.
      expect(m.functionModules[n - 1]?.[n - 1]).toBe(false);
      if (c.version >= 7) expect(fixed.some((f) => f.role === "alignment") && info.some(([, , r]) => r === "version")).toBe(true);
    });

    it(`${c.name}: in every style, function cells are plain squares (dark) or empty (light), identical across styles`, () => {
      const probes = STYLES.map((s) => probeCells(renderQrSvg(c.value, style(s), V * PX), V, PX, { fg: FG, bg: BG }));
      const cellsToCheck = [
        ...fixed.map((f) => ({ x: f.x, y: f.y, want: f.dark ? "fg" : "bg", role: f.role })),
        ...info.map(([x, y, role]) => ({ x, y, want: m.modules[y]?.[x] ? "fg" : "bg", role })),
      ];
      const wrong: string[] = [];
      for (const [i, p] of probes.entries())
        for (const cell of cellsToCheck) {
          const got = p.cell(cell.x + QUIET, cell.y + QUIET).kind;
          if (got !== cell.want) wrong.push(`${STYLES[i]} ${cell.role} (${cell.x},${cell.y}) ${got}≠${cell.want}`);
        }
      expect(wrong).toEqual([]);
      // Byte-for-byte the same pixels in every function cell, whichever data style is chosen.
      const mask = (p: (typeof probes)[number]) =>
        cellsToCheck
          .map((cell) =>
            Array.from({ length: PX * PX }, (_, k) => p.pixel(cell.x + QUIET, cell.y + QUIET, k % PX, Math.floor(k / PX))).join(""),
          )
          .join("|");
      expect(new Set(probes.map(mask)).size).toBe(1);
    });

    it(`${c.name}: data modules do change with the style`, () => {
      const isData = (x: number, y: number) => m.modules[y]?.[x] === true && m.functionModules[y]?.[x] === false;
      const dataCell = Array.from({ length: n * n }, (_, i) => [i % n, Math.floor(i / n)] as const).find(([x, y]) => isData(x, y));
      const [x, y] = dataCell ?? [0, 0];
      const kinds = STYLES.map(
        (s) => probeCells(renderQrSvg(c.value, style(s), V * PX), V, PX, { fg: FG, bg: BG }).cell(x + QUIET, y + QUIET).kind,
      );
      expect(kinds).toEqual(["fg", "mixed", "mixed"]);
    });

    it(`${c.name}: identical SVG for identical input, finder and quiet zone unchanged across styles`, () => {
      const svgs = STYLES.map((s) => renderQrSvg(c.value, style(s), 512));
      for (const [i, s] of STYLES.entries()) expect(renderQrSvg(c.value, style(s), 512)).toBe(svgs[i]);
      const eyes = (svg: string) => svg.match(/<path d="[^"]+" fill="#0D0D12" fill-rule="evenodd"\/>/)?.[0];
      expect(new Set(svgs.map(eyes)).size).toBe(1);
      for (const svg of svgs) {
        expect(svg).toContain(`viewBox="0 0 ${V} ${V}"`);
        expect(svg).toContain(`<rect width="${V}" height="${V}" fill="${BG}"/>`);
      }
    });
  }

  for (const pattern of ["dot", "rounded"] as const)
    it(`version 7 · ${pattern}: rasterized through the production path at two sizes, decodes to the exact payload`, async () => {
      const value = "x".repeat(110);
      const layout = designToLayout({
        ...DEFAULT_DESIGN,
        pattern,
        eyeFrame: "circle",
        eyeBall: "leaf",
        preset: "caption",
        caption: "Scan me",
      });
      const { svg, width } = composeLayout(layout, value);
      expect(composeLayout(layout, value).svg).toBe(svg);
      for (const px of [Math.round(width), Math.round(width * 3)])
        expect(await decodeImage(rasterizeSvg(svg, { width: px })), `${px}px`).toBe(value);
    });
});
