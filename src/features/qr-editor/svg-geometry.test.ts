import { composeLayout, encodePayload, encodeQr, layoutGeometry, renderQrSvg, type QrStyle } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";

/*
 * HEY-26: SVG geometry. The symbol's viewBox comes from the matrix (modules + 2 × 4 quiet-zone modules); modules are
 * drawn in that same coordinate system; inside a layout the symbol is a nested <svg> whose viewBox is the matrix's,
 * placed in the layout canvas (viewBox = canvas size); the output size is only width/height, never the geometry.
 */
const QUIET = 4;
const SQUARE: QrStyle = {
  pattern: "square",
  eyeFrame: "square",
  eyeBall: "square",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
};

/** Every point reached by the module paths (absolute M/H/V/L, relative m/h/v/l, Z), without the background rect. */
function moduleBounds(svg: string) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [, d] of svg.matchAll(/<path d="([^"]+)"/g)) {
    let x = 0;
    let y = 0;
    for (const [, cmd, args] of (d ?? "").matchAll(/([MmHhVvLlZz])([^MmHhVvLlZz]*)/g)) {
      const n = (args ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (cmd === "M" || cmd === "L") [x, y] = [n[0] ?? x, n[1] ?? y];
      else if (cmd === "m" || cmd === "l") [x, y] = [x + (n[0] ?? 0), y + (n[1] ?? 0)];
      else if (cmd === "H") x = n[0] ?? x;
      else if (cmd === "h") x += n[0] ?? 0;
      else if (cmd === "V") y = n[0] ?? y;
      else if (cmd === "v") y += n[0] ?? 0;
      else continue;
      xs.push(x);
      ys.push(y);
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Whether the data-module path draws the 1×1 cell at matrix (x, y) (square runs "M{qx} {qy}h{w}v1h-{w}z"). */
function drawsCell(svg: string, x: number, y: number) {
  return [...svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].some(
    ([, mx, my, w]) => Number(my) === QUIET + y && Number(mx) <= QUIET + x && QUIET + x < Number(mx) + Number(w),
  );
}

const SMALL = "hi"; // version 1: 21 × 21 modules
const LARGE = "x".repeat(666); // the M limit: version 20, 97 × 97 modules

describe("SVG geometry (HEY-26)", () => {
  for (const [name, value, version, size, viewBox] of [
    ["smaller matrix", SMALL, 1, 21, 29],
    ["larger matrix", LARGE, 20, 97, 105],
  ] as const)
    it(`${name}: viewBox "0 0 ${viewBox} ${viewBox}" holds every module, first to last`, () => {
      const m = encodeQr(value, "M");
      expect([m.version, m.size]).toEqual([version, size]);
      const svg = renderQrSvg(value, SQUARE, 512);
      expect(svg).toContain(`viewBox="0 0 ${viewBox} ${viewBox}"`);
      expect(svg).toContain(`<rect width="${viewBox}" height="${viewBox}"`);
      // Modules span exactly the matrix inside the quiet zone: [4, 4 + size] on both axes.
      expect(moduleBounds(svg)).toEqual({ minX: QUIET, maxX: QUIET + size, minY: QUIET, maxY: QUIET + size });
      // First module (0, 0) is the top-left finder's corner at (4, 4); the last module (size-1, size-1) is the cell
      // [4 + size - 1, 4 + size], inside the viewBox, and drawn exactly there when it is dark.
      expect(svg).toContain(`M${QUIET} ${QUIET}H${QUIET + 7}`);
      expect(QUIET + size).toBeLessThanOrEqual(viewBox - QUIET);
      expect(drawsCell(svg, size - 1, size - 1)).toBe(m.modules[size - 1]?.[size - 1] === true);
    });

  it("the output size changes only width and height, never the viewBox or the drawing", () => {
    const strip = (s: string) => s.replace(/ width="\d+" height="\d+"/, "");
    const a = renderQrSvg(SMALL, SQUARE, 256);
    const b = renderQrSvg(SMALL, SQUARE, 2048);
    expect(a).not.toBe(b);
    expect(strip(a)).toBe(strip(b));
  });

  const framed = designToLayout({ ...DEFAULT_DESIGN, preset: "frame", frameStyle: "bubble", caption: "Scan for the menu\nTable 4" });
  const captioned = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "See the menu", pattern: "dot" });

  for (const [name, layout] of [
    ["framed", framed],
    ["captioned", captioned],
  ] as const)
    it(`${name} layout: the canvas keeps its bounds, the symbol keeps the matrix viewBox, output is deterministic`, async () => {
      const g = layoutGeometry(layout);
      for (const [value, viewBox] of [
        [encodePayload({ type: "website", url: "littlefern.cafe/menu" }), 37] /* 28 bytes: version 3, 29 + 8 */,
        [LARGE, 105],
      ] as const) {
        const first = composeLayout(layout, value).svg;
        const second = composeLayout(layout, value).svg;
        expect(second).toBe(first);

        // Canvas: the outer viewBox is the layout size, whatever the matrix.
        const outer = first.match(/^<svg [^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/);
        expect(outer?.slice(1).map(Number)).toEqual([+g.width.toFixed(3), +g.height.toFixed(3)]);
        // Symbol: a nested <svg> with the matrix viewBox, placed inside the canvas.
        const nested = first.match(/<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 (\d+) (\d+)">/);
        expect(nested).not.toBeNull();
        const [x, y, w, h, vb] = (nested ?? []).slice(1, 6).map(Number) as [number, number, number, number, number];
        const expectedVb = encodeQr(value, "M").size + 2 * QUIET;
        expect(vb).toBe(expectedVb);
        expect(vb).toBe(viewBox);
        expect(w).toBe(h);
        expect(x >= 0 && y >= 0 && x + w <= g.width + 1e-6 && y + h <= g.height + 1e-6).toBe(true);
      }
    });

  it("rasterized at two output sizes, the framed layout decodes to the expected payload (HEY-25 harness)", async () => {
    const value = encodePayload({ type: "website", url: "littlefern.cafe/menu?table=4" });
    const { svg, width } = composeLayout(framed, value);
    for (const px of [Math.round(width), Math.round(width * 4)]) {
      expect(await decodeImage(rasterizeSvg(svg, { width: px }))).toBe("https://littlefern.cafe/menu?table=4");
    }
  });
});
