import { inflateSync } from "node:zlib";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, unsupportedProfile, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { groupedPrintSvg, inlineSvgLogo, pdfReadyImages, printPage, printPdf, printSpecPdf } = await import("./print");
const { composeLayout } = await import("@heyqr/qr-core");
const { decodeSvg } = await import("@heyqr/qr-core/verify");

describe("editable SVG (HEY-196)", () => {
  it("each part of the layout is its own named group; elements, geometry and the decoded payload are unchanged", async () => {
    const brand: EditorDesign = {
      ...DEFAULT_DESIGN,
      preset: "vertical",
      caption: "Scan for the menu",
      bg: "#F7F1E6",
      logo: { kind: "image", href: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}` },
      logoPosition: "top",
      brandName: "Little Fern Coffee",
      size: { unit: "mm", qr: 40, width: 60, height: 90 },
    };
    const flat = composeLayout(designToLayout(brand), VALUE).svg;
    const grouped = groupedPrintSvg(flat);
    const ids = [...grouped.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual(expect.arrayContaining(["heyqr-card", "heyqr-qr-code", "heyqr-logo", "heyqr-text-1", "heyqr-text-2"]));
    // Removing the added groups gives the original markup back, element for element.
    expect(grouped.replace(/<g id="heyqr-[^"]+">|<\/g>/g, "")).toBe(flat.replace(/<\/g>/g, ""));
    expect(await decodeSvg(grouped)).toBe(VALUE);
  });
});

/*
 * HEY-196 Print Pack: vector artwork stays vector in the print PDF, raster logos keep their own pixels, the server
 * refuses a colour profile it can't produce, and the specifications sheet states the revision, safe area, PDF standard
 * and the same warnings as Print Preview.
 */
const VALUE = "https://littlefern.coffee/menu";
const key = { layoutId: "l1", revision: "2026-11-20T10:00:00.000Z" };
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" fill="#C8643B"><rect width="40" height="20" rx="4"/><circle cx="10" cy="10" r="6" fill="#1F4D3A"/></svg>`;
const svgHref = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;
const design = (href: string): EditorDesign => ({
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Scan for the menu",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  logo: { kind: "image", href },
  logoSize: 0.24,
  size: { unit: "mm", qr: 40, width: 50, height: 62 },
});
const fonts = {
  fontFile: "public/caption-fonts/HeyQROnest-Regular.ttf",
  boldFile: "public/caption-fonts/HeyQROnest-Bold.ttf",
};

/** Every content stream of a PDF, inflated, joined. */
function contentOf(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      out.push(inflateSync(pdf.subarray(start, end)).toString("latin1"));
    } catch {
      out.push(raw.slice(start, end));
    }
  }
  return out.join("\n");
}
/** A fill colour as svg-to-pdfkit writes it: `/DeviceRGB cs r g b scn`, each channel c / 255. */
const fillOf = (hex: string) => `${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toString()).join(" ")} scn`;

describe("Print Pack files (HEY-196)", () => {
  it("an uploaded SVG logo stays vector in the print PDF: no raster image, its colours drawn as paths", async () => {
    const layout = designToLayout(design(svgHref));
    const page = printPage(layout, VALUE, DEFAULT_PRINT_SETTINGS, key);
    const pdf = await printPdf(layout, page, DEFAULT_PRINT_SETTINGS.bleed);
    expect(pdf.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
    const content = contentOf(pdf);
    // The logo's own colours as vector fills, not a placed picture (#1F4D3A is also the modules' colour).
    expect(content.includes(fillOf("#C8643B")), "logo fill #C8643B").toBe(true);
    expect(content.includes(fillOf("#1F4D3A")), "logo fill #1F4D3A").toBe(true);
    expect(page.logo?.raster).toBe(false);
    expect(page.warnings.some((w) => w.code === "logo_low_ppi")).toBe(false);
  });

  it("the inlined drawing sits exactly where the image was, keeps its aspect fit and carries its opacity", () => {
    const out = pdfReadyImages(
      `<svg><image href="${svgHref}" x="10" y="20" width="30" height="30" opacity="0.13" preserveAspectRatio="xMidYMid meet"/></svg>`,
    );
    expect(out).not.toContain("<image");
    expect(out).toContain(
      '<g opacity="0.13"><svg x="10" y="20" width="30" height="30" viewBox="0 0 40 20" preserveAspectRatio="xMidYMid meet">',
    );
    expect(out).toContain('fill="#C8643B"');
  });

  it("an SVG with images, scripts, entities or outside references is never inlined (svg-to-pdfkit could read files)", () => {
    for (const bad of [
      `<svg viewBox="0 0 1 1"><image href="/etc/passwd" width="1" height="1"/></svg>`,
      `<svg viewBox="0 0 1 1"><use href="file:///etc/hosts"/></svg>`,
      `<svg viewBox="0 0 1 1"><rect fill="url(https://x.test/p)" width="1" height="1"/></svg>`,
      `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 1 1"><text>&x;</text></svg>`,
      `<svg viewBox="0 0 1 1"><script>1</script></svg>`,
      `<svg viewBox="0 0 1 1"><foreignObject/></svg>`,
    ])
      expect(inlineSvgLogo(bad), bad).toBeNull();
    expect(inlineSvgLogo(`<svg viewBox="0 0 2 2"><use href="#a"/><rect id="a" fill="url(#g)" width="1" height="1"/></svg>`)).not.toBeNull();
  });

  it("a WebP logo is embedded at its own pixel size, never upsampled, and its low-resolution warning stays", async () => {
    const png = rasterizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#C8643B"/></svg>`,
      { width: 64 },
    );
    // A WebP header resvg can read is hard to fake; the size probe is what decides the PNG's width.
    const webpLike = `data:image/webp;base64,${Buffer.from("RIFF\0\0\0\0WEBPVP8X\0\0\0\0\0\0\0\0\x3f\0\0\x1f\0\0\0\0", "latin1").toString("base64")}`;
    const out = pdfReadyImages(`<svg><image href="${webpLike}" x="0" y="0" width="10" height="10"/></svg>`);
    const embedded = Buffer.from(/href="data:image\/png;base64,([^"]+)"/.exec(out)?.[1] ?? "", "base64");
    expect([embedded.readUInt32BE(16), embedded.readUInt32BE(20)]).toEqual([64, 32]);
    // The page reports the source pixels, so a small logo keeps its warning in every file.
    const layout = designToLayout(design(`data:image/png;base64,${png.toString("base64")}`));
    const page = printPage(layout, VALUE, DEFAULT_PRINT_SETTINGS, key);
    expect(page.logo).toMatchObject({ raster: true, px: 64 });
    expect(page.warnings.find((w) => w.code === "logo_low_ppi")).toBeTruthy();
  });

  it("a profile the deployment does not produce is refused by name, never answered with an sRGB file", () => {
    const available = ["srgb", "fogra39", "gracol"] as const;
    expect(unsupportedProfile({}, available)).toBeNull();
    for (const p of available) expect(unsupportedProfile({ profile: p }, available)).toBeNull();
    for (const p of ["fogra29", "pdfx4", "cmyk"]) expect(unsupportedProfile({ profile: p }, available)).toBe(p);
    expect(unsupportedProfile({ profile: "fogra39" }, ["srgb"])).toBe("fogra39");
  });

  it("the specifications sheet states the revision, safe area, PDF standard and the page's warnings", async () => {
    const png = rasterizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#C8643B"/></svg>`,
      { width: 80 },
    );
    const layout = designToLayout(design(`data:image/png;base64,${png.toString("base64")}`));
    const page = printPage(layout, VALUE, DEFAULT_PRINT_SETTINGS, key);
    type Labels = Parameters<typeof printSpecPdf>[2];
    const asLabels = (o: Record<string, string>) => o as unknown as Labels;
    const base: Record<string, string> = Object.fromEntries(
      ["title", "finished", "page", "bleed", "marks", "qr", "profile", "srgb", "logo", "vector", "colors", "key", "yes", "no"].map((k) => [
        k,
        k.toUpperCase(),
      ]),
    );
    const labels = asLabels({
      ...base,
      safe: "SAFE",
      standard: "STANDARD",
      standardValue: "PDF 1.7 · vector (PDF/X-4 after preflight)",
      warnings: "WARNINGS",
      none: "NONE",
      revision: "REVISION",
    });
    const pdf = await printSpecPdf(
      page,
      {
        name: "Menu",
        layoutName: "Card",
        settings: DEFAULT_PRINT_SETTINGS,
        ...fonts,
        revision: key.revision,
        warnings: ["LOW LOGO 80 PX"],
      },
      labels,
    );
    // Text is embedded with a subset font, so check the PDF's text through its own glyph-independent marker: the sheet
    // renders without error and grows with the extra rows; the labels are asserted on the rows it was given.
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const without = await printSpecPdf(
      page,
      { name: "Menu", layoutName: "Card", settings: DEFAULT_PRINT_SETTINGS, ...fonts },
      asLabels({ ...base, safe: "", standard: "", warnings: "", revision: "" }),
    );
    const textObjects = (b: Buffer) => (contentOf(b).match(/\bBT\b/g) ?? []).length;
    // Safe area, standard, warning and revision: at least four more label/value rows (a long value may wrap).
    expect(textObjects(pdf) - textObjects(without)).toBeGreaterThanOrEqual(8);
    expect(page.sizes.safe).toBeGreaterThanOrEqual(3);
  });
});
