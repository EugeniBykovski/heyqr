import { encodeQr, layoutGeometry, pngPixelSize } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, presetSize, type EditorDesign } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
// The shared export function behind GET /api/export/[layoutId]?format=png&scale=…|dpi=… (after auth and payment checks).
const { renderExport, ExportSizeError } = await import("@/server/qr/export");

/* HEY-37: PNG export at a chosen resolution. */
const VALUE = "https://littlefern.cafe/menu?table=4";
const V = encodeQr(VALUE, "M").size + 8;
const PALETTE = { fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" };
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const close = (rgb: number[], want: string) => hex(want).every((v, j) => Math.abs((rgb[j] ?? -99) - v) <= 3);

type Case = { name: string; design: EditorDesign; res: [{ scale?: number; dpi?: number }, [number, number]][] };
const CASES: Case[] = [
  {
    name: "QR only · 1080 px",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "qr", size: { unit: "px", qr: 1080, width: 1080, height: 1080 } },
    res: [
      [{ scale: 1 }, [1080, 1080]],
      [{ scale: 4 }, [4320, 4320]],
    ],
  },
  {
    name: "captioned · 1920 × 1080 px",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "caption", caption: "Scan me", size: presetSize(1920, 1080) },
    res: [
      [{ scale: 1 }, [1920, 1080]],
      [{ scale: 4 }, [7680, 4320]],
    ],
  },
  {
    // Bar frame 45.6 × 57.6 mm: at 300 dpi 538.58 × 680.31 → 539 × 680; at 600 dpi 1077.17 × 1360.63 → 1077 × 1361.
    name: "framed (bar) · 40 mm code",
    design: {
      ...DEFAULT_DESIGN,
      ...PALETTE,
      preset: "frame",
      frameStyle: "bar",
      caption: "Scan for the menu",
      size: { unit: "mm", qr: 40, width: 40, height: 40 },
    },
    res: [
      [{ dpi: 300 }, [539, 680]],
      [{ dpi: 600 }, [1077, 1361]],
    ],
  },
  {
    name: "QR only · 25.5 mm",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "qr", size: { unit: "mm", qr: 25.5, width: 25.5, height: 25.5 } },
    res: [
      [{ dpi: 300 }, [301, 301]],
      [{ dpi: 1200 }, [1205, 1205]],
    ],
  },
];

describe("PNG export resolution (HEY-37)", () => {
  for (const c of CASES)
    for (const [res, [w, h]] of c.res)
      it(`${c.name} at ${res.scale ? `${res.scale}×` : `${res.dpi} dpi`}: ${w} × ${h} px, square code, palette, decodes`, async () => {
        const layout = designToLayout(c.design);
        expect(pngPixelSize(layout, res)).toEqual({ width: w, height: h, ok: true });
        const png = (await renderExport(layout, VALUE, "png", res)).body;
        const img = readPng(new Uint8Array(png));
        expect([img.width, img.height], "PNG file size").toEqual([w, h]);

        // The code inside the PNG: square, at the layout's place and scale, with its quiet zone and palette.
        const g = layoutGeometry(layout);
        const k = img.width / g.width;
        const [qx, qy, qs] = [g.qr[0] * k, g.qr[1] * k, g.qr[2] * k];
        const mod = qs / V;
        const at = (mx: number, my: number) => {
          const i = (Math.floor(qy + (my + 0.5) * mod) * img.width + Math.floor(qx + (mx + 0.5) * mod)) * 4;
          return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
        };
        expect(close(at(1, 1), PALETTE.bg), "quiet zone").toBe(true);
        expect(close(at(4, 7.5), PALETTE.eye), "corner frame, top-left").toBe(true);
        expect(close(at(V - 5, 7.5), PALETTE.eye), "corner frame, top-right (same row: the code is square)").toBe(true);
        expect(close(at(7.5, V - 5), PALETTE.eye), "corner frame, bottom-left").toBe(true);
        expect(close(at(7.5, 7.5), PALETTE.eyeIn), "corner centre").toBe(true);
        if (c.design.preset !== "qr") expect(qs).toBeLessThan(Math.max(img.width, img.height)); // code ≠ the whole PNG

        expect(await decodeImage(new Uint8Array(png)), `PNG ${w}×${h}`).toBe(VALUE);
        const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
        for (const fill of Object.values(PALETTE)) expect(svg).toContain(`fill="${fill}"`);
        expect(await decodeImage(rasterizeSvg(svg, { width: 800 })), "exported SVG rasterized at 800 px").toBe(VALUE);
        // Up to 7680 × 4320 px rendered and decoded: give it room when the suite runs other renders in parallel.
      }, 30_000);

  it("refuses a PNG outside the export limits before rasterizing (no silent downscale)", async () => {
    const layout = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me", size: presetSize(1920, 1080) });
    expect(pngPixelSize(layout, { scale: 8 })).toEqual({ width: 15360, height: 8640, ok: false });
    await expect(renderExport(layout, VALUE, "png", { scale: 8 })).rejects.toBeInstanceOf(ExportSizeError);
    const tiny = designToLayout({ ...DEFAULT_DESIGN, preset: "qr", size: { unit: "mm", qr: 10, width: 10, height: 10 } });
    expect(pngPixelSize(tiny, { dpi: 72 })).toEqual({ width: 28, height: 28, ok: false });
  });

  it("the defaults are unchanged: 2× for screen, 300 dpi for print", async () => {
    const px = designToLayout({ ...DEFAULT_DESIGN, preset: "qr" });
    expect(readPng(new Uint8Array((await renderExport(px, VALUE, "png", {})).body)).width).toBe(1024);
    const mm = designToLayout({ ...DEFAULT_DESIGN, preset: "qr", size: { unit: "mm", qr: 40, width: 40, height: 40 } });
    expect(readPng(new Uint8Array((await renderExport(mm, VALUE, "png", {})).body)).width).toBe(472);
  });
});
