import { CENTER_LOGO_SIZE, composeLayout, layoutGeometry, renderQr, type Layout } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import {
  createLayoutRecord,
  DEFAULT_DESIGN,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  type EditorDesign,
  type LogoPlate,
} from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-52: the centre logo is 10–46 % of the QR symbol's width (modules only; the quiet zone is not part of it). That is
 * the logo box: the image is centred in it at its aspect ratio (inscribed in the circle on a circular backing). The
 * backing reaches 0.56 module past the box on each side, the cleared area 0.8 module (0.5 with no backing), and the scan
 * check counts the whole cleared area. Saved values outside the limits are drawn at the nearest limit, not rewritten.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const WIDE = `data:image/png;base64,${rasterizeSvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240"><rect width="600" height="240" rx="40" fill="rgb(200,16,46)"/></svg>`,
  { width: 600 },
).toString("base64")}`;
const design = (logoSize: number, logoPlate: LogoPlate, p: Partial<EditorDesign> = {}): EditorDesign => ({
  ...DEFAULT_DESIGN,
  pattern: "square",
  logo: { kind: "image", href: WIDE },
  logoSize,
  logoPlate,
  size: { unit: "px", qr: 600, width: 600, height: 600 },
  ...p,
});
const footprint = (layout: Layout) => {
  const { inner, viewBox, scan } = renderQr(VALUE, { ...layout.style, colors: layout.colors });
  const n = viewBox - 8; // modules: the viewBox includes 4 modules of quiet zone on each side
  const img = inner.match(/<image [^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
  const plate = inner.match(/<path d="M([\d.]+) ([\d.]+)[^"]*" fill="#FFFFFF"\/><image/);
  return {
    inner,
    n,
    viewBox,
    scan,
    image: img ? Number(img[3]) : 0,
    imageX: img ? Number(img[1]) : 0,
    plateStart: plate ? Number(plate[1]) : null,
  };
};

describe("centre logo size limit (HEY-52)", () => {
  it("is the design's 10–46 %", () => {
    expect(CENTER_LOGO_SIZE).toEqual({ min: 0.1, max: 0.46 });
  });

  for (const plate of ["square", "circle", "none"] as const)
    it(`${plate} backing: 45 % is drawn at 45 %, 46 % at the maximum, 47 % no larger; footprint follows the rule`, () => {
      const [below, at, above] = [0.45, 0.46, 0.47].map((s) => footprint(designToLayout(design(s, plate))));
      const n = at?.n ?? 0;
      const box = (s: number) => (plate === "circle" ? (s * n) / Math.SQRT2 : s * n);
      expect(below?.image).toBeCloseTo(box(0.45), 2);
      expect(at?.image).toBeCloseTo(box(0.46), 2);
      expect(above?.inner).toBe(at?.inner); // clamped: identical drawing
      // The image box is centred in the symbol (quiet zone included in the viewBox, so centre = viewBox / 2).
      expect((at?.imageX ?? 0) + (at?.image ?? 0) / 2).toBeCloseTo((at?.viewBox ?? 0) / 2, 2);
      // The rounded backing's path starts after its 0.8-module corner radius.
      if (plate === "square") expect(at?.plateStart).toBeCloseTo((at?.viewBox ?? 0) / 2 - (0.46 * n) / 2 - 0.56 + 0.8, 2);
      if (plate === "none") expect(at?.plateStart).toBeNull();
    });

  it("no module is drawn under the logo or its backing at the maximum (the full cleared area is free)", async () => {
    for (const plate of ["square", "circle", "none"] as const) {
      const layout = designToLayout(design(0.46, plate));
      const png = readPng(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body));
      const g = layoutGeometry(layout);
      const { n, viewBox } = footprint(layout);
      const k = g.qr[2] / viewBox;
      const c = g.qr[0] + g.qr[2] / 2;
      const half = ((plate === "circle" ? (0.46 * n) / Math.SQRT2 : 0.46 * n) / 2) * k; // the image box
      for (let y = Math.ceil(c - half); y < c + half; y++)
        for (let x = Math.ceil(c - half); x < c + half; x++) {
          const i = (y * png.width + x) * 4;
          expect((png.data[i] ?? 255) < 90 && (png.data[i + 1] ?? 255) < 90, `${plate}: module at ${x},${y}`).toBe(false);
        }
    }
  });

  it("the logo's size is relative to the code: resizing the layout keeps the same drawing", () => {
    const small = designToLayout(design(0.3, "circle", { size: { unit: "px", qr: 300, width: 300, height: 300 } }));
    const large = designToLayout(design(0.3, "circle", { size: { unit: "px", qr: 1800, width: 1800, height: 1800 } }));
    expect(footprint(small).inner).toBe(footprint(large).inner);
  });
});

describe("older layouts with an oversized saved logo (HEY-52)", () => {
  it("are drawn at the maximum in preview and export alike, and keep their saved value until edited", async () => {
    const legacy = design(0.6, "square");
    const record = createLayoutRecord(designToLayout(legacy), designSettingsOf(legacy));
    if (!record) throw new Error("older record refused");
    expect(record.layout.style.logo?.size).toBe(0.6); // not rewritten
    const reopened = designFromSaved({ name: "x", model: "static", content: { type: "website", url: VALUE } }, record);
    expect(reopened.logoSize).toBe(0.6);
    const atMax = composeLayout(designToLayout(design(0.46, "square")), VALUE).svg;
    expect(composeLayout(record.layout, VALUE).svg).toBe(atMax); // the preview's drawing
    expect((await renderExport(record.layout, VALUE, "svg", {})).body.toString()).toBe(atMax); // the downloaded SVG
  });

  it("a corrected size saves and reopens as that size", () => {
    const fixed = design(0.28, "circle");
    const record = createLayoutRecord(designToLayout(fixed), designSettingsOf(fixed));
    if (!record) throw new Error("refused");
    expect(designFromSaved({ name: "x", model: "static", content: { type: "website", url: VALUE } }, record).logoSize).toBe(0.28);
  });
});

describe("the limit in the four layouts (HEY-52)", () => {
  const base = design(0.46, "circle", { caption: "Little Fern Café" });
  const caption = designToLayout({ ...base, preset: "caption", size: { unit: "px", qr: 600, width: 900, height: 760 } });
  const LAYOUTS: [string, Layout][] = [
    ["QR only", designToLayout({ ...base, preset: "qr" })],
    ["QR + caption", caption],
    ["Vertical card", { ...caption, preset: "vertical", width: 700, height: 980, qrSize: 600 }],
    ["Horizontal card", { ...caption, preset: "horizontal", width: 1200, height: 640, qrSize: 560 }],
  ];
  for (const [name, layout] of LAYOUTS)
    it(`${name}: at most 46 % of the code; when the check flags it, the suggested size scans; SVG and PNG decode`, async () => {
      const { n, image, scan } = footprint(layout);
      expect(image).toBeLessThanOrEqual((0.46 * n) / Math.SQRT2 + 1e-3); // SVG coordinates are written to 3 decimals
      const usable = scan.ok
        ? layout
        : { ...layout, style: { ...layout.style, logo: layout.style.logo && { ...layout.style.logo, size: scan.maxLogoSize } } };
      if (!scan.ok) {
        expect(scan.issues.map((i) => i.code)).toContain("logo");
        expect(scan.maxLogoSize).toBeGreaterThanOrEqual(CENTER_LOGO_SIZE.min);
      }
      expect(composeLayout(usable, VALUE).scan.ok).toBe(true);
      const svg = (await renderExport(usable, VALUE, "svg", {})).body.toString();
      expect(await decodeSvg(svg, 1000)).toBe(VALUE);
      expect(await decodeImage(new Uint8Array((await renderExport(usable, VALUE, "png", { scale: 1 })).body))).toBe(VALUE);
    }, 30_000);
});

describe("a failure within the allowed range (HEY-52)", () => {
  it("a 40 % square-backed logo on a small code is flagged; the suggested size scans and decodes", async () => {
    const SMALL = "https://a.co/menu1";
    const layout = designToLayout(design(0.4, "square"));
    const scan = composeLayout(layout, SMALL).scan;
    expect(scan.ok).toBe(false);
    expect(scan.maxLogoSize).toBeLessThan(0.4);
    const fixed = designToLayout(design(scan.maxLogoSize, "square"));
    expect(composeLayout(fixed, SMALL).scan.ok).toBe(true);
    expect(await decodeSvg(composeLayout(fixed, SMALL).svg, 1000)).toBe(SMALL);
    // One percent more than suggested would not pass: the suggestion is the largest that scans.
    expect(composeLayout(designToLayout(design(scan.maxLogoSize + 0.01, "square")), SMALL).scan.ok).toBe(false);
  });
});
