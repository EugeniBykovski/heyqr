import { brandHeader, captionFaceFile, composeLayout, imageAspect, layoutGeometry, measureCaptionText } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, SAMPLE_LOGO, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport, withEmbeddedImages } = await import("@/server/qr/export");
const { printPage } = await import("@/server/print/print");

/*
 * Design 2.8 Brand card (Little Fern Coffee): the logo and the brand name stay inside the card's header band in every
 * output. The logo has a bounded box with its own aspect ratio; the name is measured with the caption font and
 * wrapped or reduced to the space beside it. The code and its quiet zone don't move.
 */
const VALUE = "https://littlefern.coffee/menu";
const svgLogo = (w: number, h: number) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${Math.min(w, h) / 4}" fill="#1F4D3A"/></svg>`)}`;
const pngLogo = (w: number, h: number) =>
  `data:image/png;base64,${rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#C8643B"/></svg>`, { width: w }).toString("base64")}`;
const LOGOS = {
  "built-in sample (square SVG)": SAMPLE_LOGO,
  "uploaded wide SVG": svgLogo(600, 120),
  "uploaded tall SVG": svgLogo(120, 600),
  "uploaded wide PNG": pngLogo(800, 200),
  "uploaded square PNG": pngLogo(256, 256),
};
const NAMES = ["Little Fern Coffee", "Little Fern Coffee Roasters & Neighbourhood Bakery", "Littlefernspecialtycoffeeroasters"];
const brandCard = (logo: string, brandName: string, p: Partial<EditorDesign> = {}): EditorDesign => ({
  ...DEFAULT_DESIGN,
  preset: "vertical",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  caption: "Scan for the menu",
  logo: { kind: "image", href: logo },
  logoPosition: "top",
  brandName,
  ...p,
});
const EPS = 1e-6;

describe("Brand card header stays inside its band (design 2.8)", () => {
  it("reads image aspect ratios from data URLs", () => {
    expect(imageAspect(SAMPLE_LOGO)).toBe(1);
    expect(imageAspect(svgLogo(600, 120))).toBe(5);
    expect(imageAspect(pngLogo(800, 200))).toBe(4);
    expect(imageAspect("https://example.com/logo.png")).toBeNull();
  });

  for (const [kind, logo] of Object.entries(LOGOS))
    for (const name of NAMES)
      for (const preset of ["vertical", "horizontal"] as const)
        it(`${preset} · ${kind} · “${name.slice(0, 24)}…”`, () => {
          const layout = designToLayout(brandCard(logo, name, { preset }));
          const g = layoutGeometry(layout);
          const h = brandHeader(layout, g);
          if (!h || !g.top || !h.name) throw new Error("no header");
          const [bx, by, bw, bh] = g.top;
          const [lx, ly, lw, lh] = h.logo;
          // The logo: inside the band, its own aspect ratio.
          expect(lx).toBeGreaterThanOrEqual(bx - EPS);
          expect(ly).toBeGreaterThanOrEqual(by - EPS);
          expect(lx + lw).toBeLessThanOrEqual(bx + bw + EPS);
          expect(ly + lh).toBeLessThanOrEqual(by + bh + EPS);
          expect(lw / lh).toBeCloseTo(Math.min(8, imageAspect(logo) ?? 1), 5);
          // The name: at most two lines, every line within the band right of the logo, the block within its height.
          // Two lines when they fit at a readable size; a very long name in a narrow band may take a third.
          expect(h.name.lines.length).toBeLessThanOrEqual(3);
          // Every word of the name is drawn (nothing is cut to make it fit).
          expect(h.name.lines.join(" ").replace(/\s+/g, "")).toBe(name.replace(/\s+/g, ""));
          expect(h.name.x).toBeGreaterThanOrEqual(lx + lw);
          const file = captionFaceFile(layout.caption.font, h.name.weight);
          for (const line of h.name.lines) expect(h.name.x + measureCaptionText(line, file, h.name.fs)).toBeLessThanOrEqual(bx + bw + EPS);
          expect(h.name.y - h.name.fs * 0.92).toBeGreaterThanOrEqual(by - EPS);
          expect(h.name.y + (h.name.lines.length - 1) * h.name.fs * 1.18 + h.name.fs * 0.3).toBeLessThanOrEqual(by + bh + EPS);
          // The header never reaches the code.
          if (preset === "vertical") expect(by + bh).toBeLessThanOrEqual(g.qr[1] + EPS);
          else expect(bx).toBeGreaterThanOrEqual(g.qr[0] + g.qr[2] - EPS);
          // The drawn SVG uses exactly that box.
          const svg = composeLayout(layout, VALUE).svg;
          expect(svg).toContain(
            `width="${Math.round(lw * 1000) / 1000}" height="${Math.round(lh * 1000) / 1000}" preserveAspectRatio="xMidYMid meet"`,
          );
        });

  it("without a name the logo is centred in the band", () => {
    const layout = designToLayout(brandCard(svgLogo(600, 120), ""));
    const g = layoutGeometry(layout);
    const h = brandHeader(layout, g);
    if (!h || !g.top) throw new Error("no header");
    expect(h.name).toBeNull();
    expect(h.logo[0] + h.logo[2] / 2).toBeCloseTo(g.top[0] + g.top[2] / 2, 6);
  });
});

describe("Little Fern Coffee Brand card exports (PNG, SVG, print PDF page) decode and keep the header", () => {
  const design = brandCard(SAMPLE_LOGO, "Little Fern Coffee Roasters & Neighbourhood Bakery", {
    size: { unit: "mm", qr: 41, width: 55, height: 85 },
  });

  it("PNG and SVG decode; the embedded SVG draws the same header box as the editor", async () => {
    const layout = designToLayout(design);
    const editorSvg = composeLayout(layout, VALUE).svg;
    const png = await renderExport(layout, VALUE, "png", { dpi: 300 });
    expect(await decodeImage(new Uint8Array(png.body))).toBe(VALUE);
    const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
    const image = (s: string) => s.match(/<image [^>]*preserveAspectRatio="xMidYMid meet"\/>/)?.[0]?.replace(/href="[^"]*"/, "");
    expect(image(svg)).toBe(image(editorSvg));
    expect(svg).toContain("@font-face"); // the brand name's bold face is embedded
    expect(await decodeImage(rasterizeSvg(svg, { width: 1200 }))).toBe(VALUE);
  }, 60_000);

  it("the print page keeps the header and decodes", async () => {
    const layout = await withEmbeddedImages(designToLayout(design));
    const page = printPage(layout, VALUE, DEFAULT_PRINT_SETTINGS, { layoutId: "l", revision: "r" });
    expect(page.scanOk).toBe(true);
    expect(await decodeImage(rasterizeSvg(page.svg, { width: 1400 }))).toBe(VALUE);
  }, 60_000);
});
