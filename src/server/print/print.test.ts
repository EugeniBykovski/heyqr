import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, printSizes, readPrintSettings, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { layoutPdf, printPage, printPdf, printSpecPdf, rasterSize, renderKeyOf } = await import("./print");

/* Design 8.x Print Pack: the print page, the vector PDF and the specifications from one function. */
const VALUE = "https://littlefern.coffee/menu";
const small = `data:image/png;base64,${rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="38" fill="#C8643B"/></svg>`, { width: 80 }).toString("base64")}`;
const card: EditorDesign = {
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Scan for the menu",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  logo: { kind: "image", href: small },
  logoSize: 0.24,
  size: { unit: "mm", qr: 40, width: 50, height: 62 },
};
const key = { layoutId: "l1", revision: "2026-11-20T10:00:00.000Z" };
const MM_TO_PT = 72 / 25.4;

describe("print sizes and settings", () => {
  it("finished = layout × scale; the page adds bleed and room for crop marks; QR includes its quiet zone", () => {
    const layout = designToLayout(card);
    expect(printSizes(layout, DEFAULT_PRINT_SETTINGS)).toMatchObject({
      finished: { width: 50, height: 62 },
      page: { width: 68, height: 80 },
      qr: 40,
    });
    expect(printSizes(layout, { ...DEFAULT_PRINT_SETTINGS, scale: 1.5, bleed: 0, cropMarks: false })).toMatchObject({
      finished: { width: 75, height: 93 },
      page: { width: 75, height: 93 },
      qr: 60,
    });
    expect(readPrintSettings({ width: "100" }, layout).scale).toBe(2);
    expect(readPrintSettings({ bleed: "7", profile: "fogra39" }, layout)).toMatchObject({ bleed: 3, profile: "srgb" });
  });

  it("the render key changes with the layout revision and every setting", () => {
    const a = renderKeyOf("l1", "r1", DEFAULT_PRINT_SETTINGS);
    expect(renderKeyOf("l1", "r2", DEFAULT_PRINT_SETTINGS)).not.toBe(a);
    expect(renderKeyOf("l1", "r1", { ...DEFAULT_PRINT_SETTINGS, bleed: 5 })).not.toBe(a);
    expect(renderKeyOf("l1", "r1", DEFAULT_PRINT_SETTINGS)).toBe(a);
  });

  it("reads raster logo sizes from their headers", () => {
    expect(rasterSize(small)).toEqual({ width: 80, height: 80 });
    expect(rasterSize("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
  });
});

describe("print files", () => {
  it("the PDF page is trim + bleed + crop marks, vector, and decodes when rasterized", async () => {
    const layout = designToLayout(card);
    const page = printPage(layout, VALUE, DEFAULT_PRINT_SETTINGS, key);
    expect(page.scanOk).toBe(true);
    const pdf = await printPdf(layout, page, DEFAULT_PRINT_SETTINGS.bleed);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(Number(box?.[1])).toBeCloseTo(68 * MM_TO_PT, 1);
    expect(Number(box?.[2])).toBeCloseTo(80 * MM_TO_PT, 1);
    expect(text).toContain("/FontFile2"); // the caption font is embedded
    // HEY-69: TrimBox is the finished 50 × 62 mm inside 3 mm bleed and 6 mm for crop marks; BleedBox adds the bleed.
    const pt = (v: string | undefined) => (v ?? "").split(" ").map((n) => Number(n) / MM_TO_PT);
    const trim = pt(text.match(/\/TrimBox \[([\d. ]+)\]/)?.[1]);
    const bleed = pt(text.match(/\/BleedBox \[([\d. ]+)\]/)?.[1]);
    trim.forEach((v, i) => expect(v).toBeCloseTo([9, 9, 59, 71][i] ?? NaN, 2));
    bleed.forEach((v, i) => expect(v).toBeCloseTo([6, 6, 62, 74][i] ?? NaN, 2));
    expect([trim.length, bleed.length]).toEqual([4, 4]);
    // macOS renders PDFs with sips; elsewhere the page SVG (the same drawing) is decoded instead.
    const dir = mkdtempSync(path.join(tmpdir(), "heyqr-print-"));
    writeFileSync(path.join(dir, "p.pdf"), pdf);
    let png: Uint8Array;
    try {
      execFileSync("sips", ["-s", "format", "png", "-Z", "1600", path.join(dir, "p.pdf"), "--out", path.join(dir, "p.png")], {
        stdio: "ignore",
      });
      png = new Uint8Array(readFileSync(path.join(dir, "p.png")));
    } catch {
      png = rasterizeSvg(page.svg, { width: 1600 });
    }
    expect(await decodeImage(png)).toBe(VALUE);
  }, 60_000);

  it("a small raster logo at 150 % gets the resolution warning with the pixels it needs; a vector logo never does", () => {
    const at150 = printPage(designToLayout(card), VALUE, { ...DEFAULT_PRINT_SETTINGS, scale: 1.5 }, key);
    const warn = at150.warnings.find((w) => w.code === "logo_low_ppi");
    expect(warn && warn.code === "logo_low_ppi" && warn.ppi).toBeLessThan(300);
    expect(warn && warn.code === "logo_low_ppi" && warn.needPx).toBeGreaterThan(80);
    const icon = printPage(designToLayout({ ...card, logo: { kind: "icon", icon: "coffee" } }), VALUE, DEFAULT_PRINT_SETTINGS, key);
    expect(icon.warnings.map((w) => w.code)).not.toContain("logo_low_ppi");
  });

  it("warns when the code prints under 20 mm", () => {
    const tiny = printPage(
      designToLayout({ ...card, size: { unit: "mm", qr: 15, width: 20, height: 24 } }),
      VALUE,
      DEFAULT_PRINT_SETTINGS,
      key,
    );
    expect(tiny.warnings.map((w) => w.code)).toContain("qr_small");
  });

  it("the specifications sheet lists the sizes and colours", async () => {
    const page = printPage(designToLayout(card), VALUE, DEFAULT_PRINT_SETTINGS, key);
    const font = path.join(process.cwd(), "public/caption-fonts/HeyQROnest-Regular.ttf");
    const bold = path.join(process.cwd(), "public/caption-fonts/HeyQROnest-Bold.ttf");
    const pdf = await printSpecPdf(
      page,
      { name: "Menu", layoutName: "Table tent", settings: DEFAULT_PRINT_SETTINGS, fontFile: font, boldFile: bold },
      {
        title: "Print specifications",
        finished: "Finished size",
        page: "PDF page",
        bleed: "Bleed",
        marks: "Crop marks",
        qr: "QR size",
        profile: "Color profile",
        srgb: "sRGB",
        logo: "Logo",
        vector: "Vector",
        colors: "Colors",
        key: "Render key",
        yes: "Yes",
        no: "No",
      },
    );
    expect(pdf.toString("latin1").startsWith("%PDF-1.7")).toBe(true);
    expect(pdf.length).toBeGreaterThan(2000);
  });
});

describe("layout PDF export (format PDF)", () => {
  it("is one vector page at the layout's own size: mm layouts in mm, screen layouts at 96 px per inch", async () => {
    const mm = await layoutPdf(designToLayout(card), VALUE);
    const box = (b: Buffer) =>
      b
        .toString("latin1")
        .match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
        ?.slice(1)
        .map(Number);
    expect(mm.scanOk).toBe(true);
    expect(box(mm.body)?.[0]).toBeCloseTo(50 * MM_TO_PT, 1);
    const px = await layoutPdf(designToLayout({ ...card, size: { unit: "px", qr: 512, width: 512, height: 640 } }), VALUE);
    expect(box(px.body)?.map((v) => Math.round(v))).toEqual([384, 480]);
  }, 60_000);
});
