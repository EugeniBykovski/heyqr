import { encodeQr, layoutGeometry, type Layout } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

// renderExport is the shared export path behind GET /api/export/[layoutId] (after auth and entitlement checks).
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport, pngWidth } = await import("@/server/qr/export");

/*
 * HEY-33: background, data modules, corner frames and corner centres are separate colours from the editor through the
 * exported files. The control palette has a non-white background and three distinct, high-contrast inks.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const QUIET = 4;
const CONTROL = { fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" };
const DEFAULT = { fg: DEFAULT_DESIGN.fg, eye: DEFAULT_DESIGN.fg, eyeIn: DEFAULT_DESIGN.fg, bg: DEFAULT_DESIGN.bg };

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

function sampler(png: Uint8Array, layout: Layout) {
  const img = readPng(png);
  const g = layoutGeometry(layout);
  const k = img.width / g.width;
  const n = encodeQr(VALUE, layout.style.logo ? "H" : "M").size;
  const V = n + 2 * QUIET;
  const modulePx = (g.qr[2] / V) * k;
  /** Colour at the centre of matrix cell (x, y); negative values reach into the quiet zone. */
  return (x: number, y: number) => {
    const px = Math.floor(g.qr[0] * k + (QUIET + x + 0.5) * modulePx);
    const py = Math.floor(g.qr[1] * k + (QUIET + y + 0.5) * modulePx);
    const i = (py * img.width + px) * 4;
    return `#${[0, 1, 2]
      .map((j) => (img.data[i + j] ?? 0).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  };
}
const close = (got: string, want: string) => hex(got).every((v, j) => Math.abs(v - (hex(want)[j] ?? 0)) <= 3);

for (const [name, palette] of [
  ["control palette", CONTROL],
  ["default palette", DEFAULT],
] as const)
  describe(`Colours through the export path · ${name} (HEY-33)`, () => {
    const design: EditorDesign =
      name === "control palette" ? { ...DEFAULT_DESIGN, ...CONTROL, pattern: "rounded" } : { ...DEFAULT_DESIGN, pattern: "rounded" };
    const layout = designToLayout(design);

    it("the layout carries the four colours (corners follow the modules when not set)", () => {
      expect(layout.colors).toMatchObject(palette);
    });

    it("exported SVG: background, data modules, corner frames and corner centres use their own fills", async () => {
      const { body } = await renderExport(layout, VALUE, "svg", {});
      const svg = body.toString();
      const V = encodeQr(VALUE, "M").size + 2 * QUIET;
      expect(svg).toContain(`<rect width="${V}" height="${V}" fill="${palette.bg}"/>`);
      const paths = [...svg.matchAll(/<path d="[^"]+" fill="(#[0-9A-Fa-f]{6})"( fill-rule="evenodd")?\/>/g)].map((m) => [
        m[1],
        Boolean(m[2]),
      ]);
      expect(paths).toContainEqual([palette.fg, false]); // data modules
      expect(paths).toContainEqual([palette.eye, true]); // corner frames (ring with a hole)
      expect(paths).toContainEqual([palette.eyeIn, false]); // corner centres
    });

    it("exported PNG: interior pixels of each region and the quiet zone have the intended colour", async () => {
      const { body } = await renderExport(layout, VALUE, "png", {});
      const at = sampler(new Uint8Array(body), layout);
      const m = encodeQr(VALUE, "M");
      // A dark data module (not a function module) — its centre.
      const data = m.modules
        .flatMap((row, y) => row.map((d, x) => [x, y, d && !m.functionModules[y]?.[x]] as const))
        .find(([, , ok]) => ok);
      const [dx, dy] = data ?? [0, 0];
      const samples = {
        "data module": [at(dx, dy), palette.fg],
        "corner frame (ring)": [at(0, 3), palette.eye],
        "corner frame, other finder": [at(m.size - 1, 3), palette.eye],
        "corner centre": [at(3, 3), palette.eyeIn],
        "corner centre, bottom-left finder": [at(3, m.size - 4), palette.eyeIn],
        "quiet zone": [at(-2, -2), palette.bg],
        "light gap inside the finder": [at(1, 3), palette.bg],
      } as const;
      const wrong = Object.entries(samples)
        .filter(([, [got, want]]) => !close(got, want))
        .map(([k, [got, want]]) => `${k}: ${got} ≠ ${want}`);
      expect(wrong).toEqual([]);
    });

    it("the exported PNG and a rasterized copy of the exported SVG both decode to the exact payload", async () => {
      const png = await renderExport(layout, VALUE, "png", {});
      expect(await decodeImage(new Uint8Array(png.body)), "exported PNG").toBe(VALUE);
      const svg = await renderExport(layout, VALUE, "svg", {});
      const width = pngWidth(layout, layoutGeometry(layout).width, {});
      expect(await decodeImage(rasterizeSvg(svg.body.toString(), { width })), "rasterized SVG").toBe(VALUE);
    });
  });
