import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { bundledIcc, createConverter, iccHeader, ICC_PROFILES, ProfileUnavailableError, rgbOfHex } = await import("./cmyk");
const { printPage, printPdf } = await import("./print");

/* HEY-188: CMYK print PDFs, converted with Little CMS to a bundled ICC profile that is embedded as the output intent. */
const VALUE = "https://littlefern.coffee/menu";
const MM_TO_PT = 72 / 25.4;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// A 120 px raster logo with a transparent corner (the low-resolution case: it prints at about 100 ppi).
const logo = `data:image/png;base64,${rasterizeSvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="56" fill="#C8643B"/><rect x="40" y="40" width="40" height="40" fill="#1F4D3A"/></svg>`,
  { width: 120 },
).toString("base64")}`;
const card: EditorDesign = {
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Scan for the menu",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  eyeIn: "#C8643B",
  logo: { kind: "image", href: logo },
  logoSize: 0.24,
  size: { unit: "mm", qr: 40, width: 50, height: 62 },
};
const key = { layoutId: "l1", revision: "2026-11-27T10:00:00.000Z" };

/** The PDF's objects: their dictionary text and, for streams, the decoded bytes. */
function objects(pdf: Buffer) {
  const raw = pdf.toString("latin1");
  const out: { id: number; dict: string; stream: Buffer | null }[] = [];
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    const body = raw.slice(start, end);
    const s = body.indexOf("stream\n");
    const dict = s >= 0 ? body.slice(0, s) : body;
    let stream: Buffer | null = null;
    if (s >= 0) {
      const bytes = Buffer.from(body.slice(s + 7, body.lastIndexOf("endstream")), "latin1");
      stream = /\/Filter \/FlateDecode/.test(dict) ? inflateSync(bytes) : bytes;
    }
    out.push({ id: Number(m[1]), dict, stream });
  }
  return out;
}

async function pdfFor(profile: "fogra39" | "gracol", design = card) {
  const cmyk = await createConverter(profile, bundledIcc(profile));
  const layout = designToLayout(design);
  const settings = { ...DEFAULT_PRINT_SETTINGS, profile };
  const page = printPage(layout, VALUE, settings, key);
  return { pdf: await printPdf(layout, page, settings.bleed, cmyk), cmyk, page };
}

describe("ICC profiles and the colour engine (HEY-188)", () => {
  it("the bundled profiles are the registry files: CMYK output profiles with their recorded SHA-256", () => {
    for (const p of ["fogra39", "gracol"] as const) {
      const icc = bundledIcc(p);
      expect(sha(icc)).toBe(ICC_PROFILES[p].sha256);
      expect(iccHeader(icc)).toMatchObject({ deviceClass: "prtr", colorSpace: "CMYK", size: icc.length });
    }
    expect(ICC_PROFILES.fogra29.bundled).toBeNull();
    expect(() => bundledIcc("fogra29")).toThrow(ProfileUnavailableError);
  });

  it("converts sRGB to the press: paper white is no ink, black is full K within the profile's ink limit", async () => {
    for (const [p, tac] of [
      ["fogra39", 300],
      ["gracol", 320],
    ] as const) {
      const c = await createConverter(p, bundledIcc(p));
      expect(c.color([255, 255, 255])).toEqual([0, 0, 0, 0]);
      const black = c.color([0, 0, 0]);
      expect(black[3]).toBeGreaterThan(99);
      expect(black.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(tac + 1);
    }
  });

  it("reference values (Little CMS 2, relative colorimetric with black point compensation)", async () => {
    const f39 = await createConverter("fogra39", bundledIcc("fogra39"));
    const gra = await createConverter("gracol", bundledIcc("gracol"));
    // Without black point compensation the same transform agrees with macOS ColorSync (an independent CMM) within 0.5
    // percentage points for these colours; BPC moves dark colours such as #1F4D3A by design (docs/PRINT_CMYK.md).
    expect(f39.color(rgbOfHex("#1F4D3A"))).toEqual([71.31, 15.88, 61.46, 66.99]);
    expect(f39.color(rgbOfHex("#C8643B"))).toEqual([1.28, 64.83, 74.88, 20.41]);
    expect(f39.color(rgbOfHex("#FF0000"))).toEqual([0.01, 93.34, 99.85, 0]);
    expect(f39.color(rgbOfHex("#F7F1E6"))).toEqual([3.55, 5.01, 11.42, 0]);
    expect(gra.color(rgbOfHex("#1F4D3A"))).toEqual([77.43, 27.54, 67.46, 59.78]);
    expect(gra.color(rgbOfHex("#C8643B"))).toEqual([3.18, 65.55, 75.09, 17.08]);
    expect(gra.color(rgbOfHex("#FF0000"))).toEqual([0, 93.26, 98.43, 0]);
    expect(gra.color(rgbOfHex("#F7F1E6"))).toEqual([3.4, 4.24, 9.77, 0]);
  });

  it("refuses a profile that isn't a CMYK output profile", async () => {
    const notCmyk = Buffer.from(bundledIcc("gracol"));
    notCmyk.write("mntr", 12, "latin1");
    await expect(createConverter("gracol", notCmyk)).rejects.toBeInstanceOf(ProfileUnavailableError);
  });
});

describe("CMYK print PDF (HEY-188)", () => {
  for (const profile of ["fogra39", "gracol"] as const) {
    it(`${profile}: DeviceCMYK only, the ICC profile as its output intent, the page boxes kept`, async () => {
      const { pdf, cmyk } = await pdfFor(profile);
      const objs = objects(pdf);
      const text = objs
        .map((o) => o.dict + (o.stream && !/\/Subtype \/Image|\/N 4|FontFile/.test(o.dict) ? o.stream.toString("latin1") : ""))
        .join("\n");
      expect(text).not.toMatch(/DeviceRGB/);
      expect(text).toContain("/DeviceCMYK");
      // The output intent and its profile, byte for byte.
      const intent = objs.find((o) => /\/Type \/OutputIntent/.test(o.dict));
      expect(intent?.dict).toMatch(/\/S \/GTS_PDFX/);
      expect(intent?.dict).toContain(`/OutputConditionIdentifier (${ICC_PROFILES[profile].outputIntent.identifier})`);
      const dest = Number(intent?.dict.match(/\/DestOutputProfile (\d+) 0 R/)?.[1]);
      const icc = objs.find((o) => o.id === dest);
      expect(icc?.dict).toMatch(/\/N 4/);
      expect(icc?.stream && sha(icc.stream)).toBe(cmyk.sha256);
      expect(objs.find((o) => /\/Type \/Catalog/.test(o.dict))?.dict).toMatch(/\/OutputIntents \[\d+ 0 R\]/);
      // Page boxes as for sRGB: 68 × 80 mm page, 50 × 62 mm trim.
      const raw = pdf.toString("latin1");
      const box = raw.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
      expect(Number(box?.[1]) / MM_TO_PT).toBeCloseTo(68, 1);
      expect(Number(box?.[2]) / MM_TO_PT).toBeCloseTo(80, 1);
      const trim = (raw.match(/\/TrimBox \[([\d. ]+)\]/)?.[1] ?? "").split(" ").map((n) => Number(n) / MM_TO_PT);
      trim.forEach((v, i) => expect(v).toBeCloseTo([9, 9, 59, 71][i] ?? NaN, 2));
      expect(raw).toMatch(/\/BleedBox \[/);
      expect(raw.startsWith("%PDF-1.7")).toBe(true);
    });
  }

  it("colours are the converted values; the raster logo is a CMYK image at its own 120 px with its transparency", async () => {
    const { pdf, cmyk } = await pdfFor("fogra39");
    const objs = objects(pdf);
    const content = objs
      .filter((o) => o.stream && !/\/Subtype|\/N 4|FontFile|\/Length1/.test(o.dict))
      .map((o) => o.stream?.toString("latin1") ?? "")
      .join("\n");
    // Fills of the modules, background and corner centres as their CMYK values (PDFKit writes percentages / 100).
    const scn = (hex: string) =>
      `${cmyk
        .color(rgbOfHex(hex))
        .map((v) => v / 100)
        .join(" ")} scn`;
    for (const hex of ["#1F4D3A", "#F7F1E6", "#C8643B"]) expect(content.includes(scn(hex)), hex).toBe(true);
    expect(content).toMatch(/\/DeviceCMYK cs/);
    expect(content).not.toMatch(/\/DeviceRGB/);
    const images = objs.filter((o) => /\/Subtype \/Image/.test(o.dict));
    const color = images.find((o) => /\/ColorSpace \/DeviceCMYK/.test(o.dict));
    expect(color?.dict).toMatch(/\/Width 120/);
    expect(color?.dict).toMatch(/\/Height 120/);
    expect(color?.stream?.length).toBe(120 * 120 * 4);
    expect(color?.dict).toMatch(/\/SMask \d+ 0 R/);
    expect(images.every((o) => /DeviceCMYK|DeviceGray/.test(o.dict))).toBe(true);
    // The logo's middle is the converted #1F4D3A (perceptual), its edge colour the converted #C8643B.
    const px = (x: number, y: number) => [...(color?.stream?.subarray((y * 120 + x) * 4, (y * 120 + x) * 4 + 4) ?? [])];
    expect(px(60, 60)).toEqual([...cmyk.pixels(new Uint8Array(rgbOfHex("#1F4D3A")), 1)]);
    expect(px(60, 10)).toEqual([...cmyk.pixels(new Uint8Array(rgbOfHex("#C8643B")), 1)]);
  });

  it("an SVG logo with a mask becomes a CMYK image; a plain one stays vector in CMYK", async () => {
    const plain = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#C8643B"/></svg>`).toString("base64")}`;
    const masked = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><mask id="m"><rect width="10" height="10" fill="#fff"/></mask><rect width="10" height="10" fill="#C8643B" mask="url(#m)"/></svg>`).toString("base64")}`;
    const a = objects((await pdfFor("gracol", { ...card, logo: { kind: "image", href: plain } })).pdf);
    expect(a.some((o) => /\/Subtype \/Image/.test(o.dict))).toBe(false);
    const b = objects((await pdfFor("gracol", { ...card, logo: { kind: "image", href: masked } })).pdf);
    expect(b.find((o) => /\/Subtype \/Image/.test(o.dict) && /DeviceCMYK/.test(o.dict))).toBeTruthy();
    for (const o of [...a, ...b]) expect(o.dict).not.toMatch(/DeviceRGB/);
  });

  it("renders and decodes at print size", async () => {
    const { pdf } = await pdfFor("fogra39");
    const dir = mkdtempSync(path.join(tmpdir(), "heyqr-cmyk-"));
    writeFileSync(path.join(dir, "p.pdf"), pdf);
    let png: Uint8Array | null = null;
    for (const [cmd, args, out] of [
      ["pdftoppm", ["-png", "-r", "300", "-singlefile", path.join(dir, "p.pdf"), path.join(dir, "a")], "a.png"],
      ["sips", ["-s", "format", "png", "-Z", "1600", path.join(dir, "p.pdf"), "--out", path.join(dir, "b.png")], "b.png"],
    ] as const) {
      try {
        execFileSync(cmd, [...args], { stdio: "ignore" });
        png = new Uint8Array(readFileSync(path.join(dir, out)));
        break;
      } catch {
        // not installed here
      }
    }
    if (png) expect(await decodeImage(png)).toBe(VALUE);
  }, 60_000);
});
