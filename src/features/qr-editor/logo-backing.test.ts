import { composeLayout, layoutGeometry, renderQr, type Layout } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign, type LogoPlate } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-51: an uploaded raster logo on its backing, drawn by the shared renderer for the preview, the SVG and the PNG.
 * Logos are real transparent PNGs (made with the project's rasterizer): a red ring with a transparent hole, and a wide
 * 600 × 240 red bar with a transparent cut-out. The code is near-black (#0D0D12) on white, so any dark pixel inside the
 * backing would be a module showing through.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const RED = [200, 16, 46];
const png = (w: number, h: number, body: string) =>
  `data:image/png;base64,${rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, { width: w }).toString("base64")}`;
const RING = png(
  256,
  256,
  `<path fill-rule="evenodd" fill="rgb(200,16,46)" d="M128 8a120 120 0 1 1 0 240a120 120 0 1 1 0-240zM128 80a48 48 0 1 0 0 96a48 48 0 1 0 0-96z"/>`,
);
const WIDE = png(
  600,
  240,
  `<path fill-rule="evenodd" fill="rgb(200,16,46)" d="M40 0H560A40 40 0 0 1 600 40V200A40 40 0 0 1 560 240H40A40 40 0 0 1 0 200V40A40 40 0 0 1 40 0ZM200 80V160H400V80Z"/>`,
);

const design = (href: string, plate: LogoPlate, size = 0.26): EditorDesign => ({
  ...DEFAULT_DESIGN,
  pattern: "square",
  logo: { kind: "image", href },
  logoSize: size,
  logoPlate: plate,
  size: { unit: "px", qr: 600, width: 600, height: 600 },
});

/** Pixels of the code area in the exported PNG at 1×, classified. */
async function analyse(layout: Layout) {
  const img = readPng(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body));
  const { scan, inner, viewBox } = renderQr(VALUE, { ...layout.style, colors: layout.colors });
  const g = layoutGeometry(layout);
  const k = g.qr[2] / viewBox; // px per module unit
  const cx = g.qr[0] + g.qr[2] / 2;
  const cy = g.qr[1] + g.qr[2] / 2;
  const at = (x: number, y: number) => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
  };
  const isRed = (p: number[]) => Math.abs((p[0] ?? 0) - (RED[0] ?? 0)) < 40 && (p[1] ?? 0) < 90 && (p[2] ?? 0) < 110;
  const isDark = (p: number[]) => (p[0] ?? 255) < 90 && (p[1] ?? 255) < 90 && (p[2] ?? 255) < 90;
  // Red bounding box: where the logo actually landed.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (isRed(at(x, y))) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  return { img, scan, inner, k, cx, cy, at, isDark, isRed, box: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

describe("raster logo on its backing (HEY-51)", () => {
  for (const [logoName, href, aspect] of [
    ["transparent ring (square)", RING, 1],
    ["wide bar 600 × 240", WIDE, 600 / 240],
  ] as const)
    for (const plate of ["square", "circle", "none"] as const)
      it(`${logoName} · ${plate} backing: centred, undistorted, on its backing with no modules showing through, scans`, async () => {
        const layout = designToLayout(design(href, plate));
        const a = await analyse(layout);
        expect(a.scan.ok).toBe(true);
        // Centred in the code and the aspect ratio kept.
        expect(Math.abs((a.box.x0 + a.box.x1) / 2 - a.cx)).toBeLessThanOrEqual(1.5);
        expect(Math.abs((a.box.y0 + a.box.y1) / 2 - a.cy)).toBeLessThanOrEqual(1.5);
        expect(a.box.w / a.box.h).toBeCloseTo(aspect, 1);
        // The cleared area (modules removed) around the logo: no dark pixel anywhere inside the logo's box, including
        // the transparent hole / cut-out, and on a backing none inside the plate either.
        for (let y = a.box.y0; y <= a.box.y1; y++)
          for (let x = a.box.x0; x <= a.box.x1; x++) expect(a.isDark(a.at(x, y)), `module at ${x},${y}`).toBe(false);
        if (plate === "circle") {
          // The whole image box fits inside the circle: corners of the logo's box stay within the plate's radius.
          const plateR = Number(a.inner.match(/<path d="M([\d.]+) ([\d.]+)a([\d.]+)/)?.[3]) * a.k;
          for (const [x, y] of [
            [a.box.x0, a.box.y0],
            [a.box.x1, a.box.y0],
            [a.box.x0, a.box.y1],
            [a.box.x1, a.box.y1],
          ])
            expect(Math.hypot((x ?? 0) - a.cx, (y ?? 0) - a.cy)).toBeLessThanOrEqual(plateR + 1);
        }
        if (plate === "none") expect(a.inner).not.toMatch(/<path d="[^"]*" fill="#FFFFFF"\/><image/);
        else expect(a.inner).toMatch(new RegExp(`<path d="[^"]+" fill="${DEFAULT_DESIGN.bg}"/><image`)); // backing, then image
        expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body))).toBe(VALUE);
      });

  it("the backing is drawn under the image and over nothing else: plate first, image last in the code", () => {
    const { inner } = renderQr(VALUE, {
      ...designToLayout(design(RING, "square")).style,
      colors: designToLayout(design(RING, "square")).colors,
    });
    expect(inner.lastIndexOf("<image")).toBeGreaterThan(inner.lastIndexOf(`fill="${DEFAULT_DESIGN.bg}"`));
    expect(inner.trimEnd().endsWith("/>")).toBe(true);
  });
});

describe("the same logo in the four layouts (HEY-51)", () => {
  const base = design(RING, "circle", 0.24);
  const caption = designToLayout({
    ...base,
    preset: "caption",
    caption: "Little Fern Café",
    size: { unit: "px", qr: 600, width: 900, height: 760 },
  });
  const LAYOUTS: [string, Layout][] = [
    ["QR only", designToLayout({ ...base, preset: "qr" })],
    ["QR + caption", caption],
    ["Vertical card", { ...caption, preset: "vertical", width: 700, height: 980, qrSize: 600 }],
    ["Horizontal card", { ...caption, preset: "horizontal", width: 1200, height: 640, qrSize: 560 }],
  ];
  for (const [name, layout] of LAYOUTS)
    it(`${name}: logo at the code's centre, SVG and PNG decode to the payload`, async () => {
      const a = await analyse(layout);
      expect(a.scan.ok).toBe(true);
      expect(Math.abs((a.box.x0 + a.box.x1) / 2 - a.cx)).toBeLessThanOrEqual(1.5);
      expect(Math.abs((a.box.y0 + a.box.y1) / 2 - a.cy)).toBeLessThanOrEqual(1.5);
      const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      expect(svg).toContain(`<image href="${RING}"`); // the raster travels inside the SVG (works offline)
      expect(await decodeSvg(svg, 900)).toBe(VALUE);
      expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body))).toBe(VALUE);
    });
});

describe("a logo too large for a small code (HEY-51)", () => {
  it("the scan check flags it, its suggested size passes, and that output decodes", async () => {
    // A short payload gives a small code (version 3) where a 36 % logo on a square backing hides too much.
    const SMALL = "https://a.co/menu1";
    const tooBig = designToLayout(design(RING, "square", 0.36));
    const first = composeLayout(tooBig, SMALL).scan;
    expect(first.ok).toBe(false);
    expect(first.issues.map((i) => i.code)).toContain("logo");
    expect(first.maxLogoSize).toBeGreaterThan(0);
    expect(first.maxLogoSize).toBeLessThan(0.36);
    const fixed = designToLayout(design(RING, "square", first.maxLogoSize));
    expect(composeLayout(fixed, SMALL).scan.ok).toBe(true);
    expect(await decodeSvg(composeLayout(fixed, SMALL).svg, 1000)).toBe(SMALL);
  });
});
