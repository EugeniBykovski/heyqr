import { existsSync } from "node:fs";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport, captionFontFaces } = await import("@/server/qr/export");

/*
 * HEY-43 / HEY-44: the exported PNG draws the caption with the caption font's own files, the ones the on-screen preview
 * loads (it fell back to a system font before HEY-43), the caption stays inside its box, and the caption never changes the encoded payload.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const AT_LIMIT = "Little Fern Café · seasonal menu & wifi\nScan at your table, order, pay in-app!!!";
const layoutFor = (caption: string) => designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption });
/** Dark pixels per image row and the horizontal extent of the caption band (rows under the 512-unit code, at 2×). */
function captionInk(png: Buffer) {
  const im = readPng(new Uint8Array(png));
  let x0 = im.width;
  let x1 = -1;
  let y0 = im.height;
  let y1 = -1;
  let ink = 0;
  for (let y = 1028; y < im.height; y++)
    for (let x = 0; x < im.width; x++) {
      const i = (y * im.width + x) * 4;
      if ((im.data[i] ?? 255) < 160) {
        ink++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  return { width: im.width, height: im.height, x0, x1, y0, y1, ink };
}

describe("caption in exported files (HEY-43)", () => {
  it("the caption's font files exist for the PNG renderer", () => {
    const files = captionFontFaces(layoutFor("Scan\nme")).map((f) => f.file);
    expect(files).toHaveLength(2);
    expect(files.every((f) => existsSync(f))).toBe(true);
  });

  for (const caption of ["Scan for the menu\nTable 4 · Little Fern Café", AT_LIMIT])
    it(`PNG caption is drawn with the caption font, inside its box, and the code decodes: ${JSON.stringify(caption.slice(0, 24))}…`, async () => {
      const layout = layoutFor(caption);
      const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      const png = (await renderExport(layout, VALUE, "png", { scale: 2 })).body;
      const ink = captionInk(png);
      expect([ink.width, ink.height]).toEqual([1024, 1250]);
      // The export rasterizes with the caption font's files: same pixels as a render given those files, and not the
      // system-font fallback it produced before.
      const sized = svg.replace(/^<svg ([^>]*?)width="[^"]*" height="[^"]*"/, '<svg $1width="1024" height="1250"');
      expect(ink).toEqual(captionInk(rasterizeSvg(sized, { width: 1024, fontFiles: captionFontFaces(layout).map((f) => f.file) })));
      expect(ink).not.toEqual(captionInk(rasterizeSvg(sized, { width: 1024 })));
      // Inside the caption box (6 %–94 % of the width, under the code): nothing clipped at the edges.
      expect(ink.x0).toBeGreaterThan(1024 * 0.06);
      expect(ink.x1).toBeLessThan(1024 * 0.94);
      expect(ink.y1).toBeLessThan(1250 - 4);
      expect(ink.ink).toBeGreaterThan(2000);
      expect(await decodeImage(new Uint8Array(png))).toBe(VALUE);
    });
});
