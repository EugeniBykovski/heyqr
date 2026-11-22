import { encodeQr } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
// The shared export function behind GET /api/export/[layoutId] (the HTTP route is exercised separately).
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-39: the exported files match what was chosen in the editor and on the export page. Every expected size below is
 * written out from the inputs (px × scale; mm ÷ 25.4 × dpi; the bar frame is 1.14 × 1.44 of the code with the code
 * inset by 0.07 of its size, per the design's frame proportions), never taken from the production size helper.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const m = encodeQr(VALUE, "M");
const V = m.size + 8; // symbol viewBox: 29 modules + 2 × 4 quiet zone = 37
const DEFAULT = { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" };
const CUSTOM = { fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" };

type Fixture = {
  name: string;
  design: EditorDesign;
  palette: typeof DEFAULT;
  resolution: { scale?: number; dpi?: number };
  svgRoot: { width: string; height: string; viewBox: string };
  png: [number, number];
  /** Where the code (quiet zone included) sits in the PNG, in px: x, y, size. */
  symbolPx: [number, number, number];
};

const screen = (palette: typeof DEFAULT, scale: number): Fixture => ({
  name: `QR only · Screen 1080 px · ${palette === DEFAULT ? "default" : "custom"} palette · ${scale}×`,
  design: {
    ...DEFAULT_DESIGN,
    ...(palette === DEFAULT ? {} : palette),
    preset: "qr",
    size: { unit: "px", qr: 1080, width: 1080, height: 1080 },
  },
  palette,
  resolution: { scale },
  svgRoot: { width: "1080", height: "1080", viewBox: "0 0 1080 1080" },
  png: [1080 * scale, 1080 * scale],
  symbolPx: [0, 0, 1080 * scale],
});
const print = (palette: typeof DEFAULT, dpi: number): Fixture => {
  const px = (mm: number) => (mm / 25.4) * dpi;
  return {
    name: `framed (bar) · Print 40 mm code · ${palette === DEFAULT ? "default" : "custom"} palette · ${dpi} dpi`,
    design: {
      ...DEFAULT_DESIGN,
      ...(palette === DEFAULT ? {} : palette),
      preset: "frame",
      frameStyle: "bar",
      caption: "Scan for the menu",
      size: { unit: "mm", qr: 40, width: 40, height: 40 },
    },
    palette,
    resolution: { dpi },
    svgRoot: { width: "45.6mm", height: "57.6mm", viewBox: "0 0 45.6 57.6" },
    png: [Math.round(px(45.6)), Math.round(px(57.6))],
    symbolPx: [px(2.8), px(2.8), px(40)],
  };
};
const FIXTURES = [screen(DEFAULT, 2), screen(CUSTOM, 4), print(DEFAULT, 600), print(CUSTOM, 300)];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

describe("Exported files match the editor and export settings (HEY-39)", () => {
  it("fixture expectations are as specified", () => {
    expect(FIXTURES.map((f) => f.png)).toEqual([
      [2160, 2160],
      [4320, 4320],
      [1077, 1361],
      [539, 680],
    ]);
  });

  for (const f of FIXTURES)
    it(f.name, async () => {
      const layout = designToLayout(f.design);

      // SVG: the file's root size, units and viewBox, the symbol size within it, and the palette fills.
      const svg = (await renderExport(layout, VALUE, "svg", f.resolution)).body.toString();
      const root = svg.match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="([^"]+)" height="([^"]+)" viewBox="([^"]+)">/);
      expect({ width: root?.[1], height: root?.[2], viewBox: root?.[3] }).toEqual(f.svgRoot);
      const nested = svg.match(/<svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" viewBox="0 0 (\d+) \d+">/);
      const symbolUnits = f.design.preset === "qr" ? [0, 0, 1080] : [2.8, 2.8, 40];
      expect(nested?.slice(1, 4).map(Number)).toEqual(symbolUnits);
      expect(Number(nested?.[4])).toBe(symbolUnits[2]); // square symbol
      expect(Number(nested?.[5])).toBe(V);
      expect(svg).toContain(`<rect width="${V}" height="${V}" fill="${f.palette.bg}"/>`);
      for (const fill of [f.palette.fg, f.palette.eye, f.palette.eyeIn]) expect(svg).toContain(`fill="${fill}"`);

      // PNG: pixel size read from the file, then interior samples at the symbol's position and scale.
      const pngBody = (await renderExport(layout, VALUE, "png", f.resolution)).body;
      const img = readPng(new Uint8Array(pngBody));
      expect([img.width, img.height], "PNG file size").toEqual(f.png);
      const [sx, sy, ss] = f.symbolPx;
      const mod = ss / V;
      const at = (mx: number, my: number) => {
        const i = (Math.floor(sy + (my + 0.5) * mod) * img.width + Math.floor(sx + (mx + 0.5) * mod)) * 4;
        return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
      };
      const data = m.modules
        .flatMap((row, y) => row.map((d, x) => [x, y, d && !m.functionModules[y]?.[x]] as const))
        .find(([, , ok]) => ok);
      const [dx, dy] = data ?? [0, 0];
      const samples: [string, number[], string][] = [
        ["quiet zone", at(1, 1), f.palette.bg],
        ["quiet zone, bottom-right", at(V - 2, V - 2), f.palette.bg],
        ["corner frame (top-left)", at(4, 7.5), f.palette.eye],
        ["corner frame (top-right, same row)", at(V - 5, 7.5), f.palette.eye],
        ["corner frame (bottom-left)", at(7.5, V - 5), f.palette.eye],
        ["corner centre", at(7.5, 7.5), f.palette.eyeIn],
        ["light gap inside a finder", at(5, 7.5), f.palette.bg],
        ["data module", at(dx + 4, dy + 4), f.palette.fg],
      ];
      const wrong = samples
        .filter(([, rgb, want]) => !hex(want).every((v, j) => Math.abs((rgb[j] ?? -99) - v) <= 4))
        .map(([k, rgb, want]) => `${k}: rgb(${rgb.join(",")}) ≠ ${want}`);
      expect(wrong).toEqual([]);

      expect(await decodeImage(new Uint8Array(pngBody)), `exported PNG ${img.width}×${img.height}`).toBe(VALUE);
      expect(await decodeImage(rasterizeSvg(svg, { width: 900 })), "exported SVG rasterized at 900 px").toBe(VALUE);
    });
});
