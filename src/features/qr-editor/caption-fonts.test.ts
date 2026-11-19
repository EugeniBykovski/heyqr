import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CAPTION_FONT_IDS,
  CAPTION_FONTS,
  captionFontFamily,
  captionWeightFor,
  composeLayout,
  supportedWeights,
  type Layout,
} from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DESIGN,
  designSettingsOf,
  designToLayout,
  readDraftDesign,
  readLayoutRecord,
  serializeDraftDesign,
  type EditorDesign,
} from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";
import { readTtf } from "../../../packages/qr-core/test/ttf-cmap";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport, captionFontFaces, CAPTION_FONT_DIR } = await import("@/server/qr/export");

const VALUE = "https://littlefern.cafe/menu?table=4";
/** Mixed-script caption with the letters the ticket names (Ё Й І ї ў), Latin, and a combining mark. */
const MIXED = "Ёлка Йод · Їжак Ії ўсё\nCafé Menü · é";
const design = (p: Partial<EditorDesign>): EditorDesign => ({ ...DEFAULT_DESIGN, preset: "caption", caption: MIXED, ...p });
const file = (f: string) => path.join(CAPTION_FONT_DIR, f);
const ink = (png: Buffer) => {
  const im = readPng(new Uint8Array(png));
  let n = 0;
  for (let y = 1028; y < im.height; y++) for (let x = 0; x < im.width; x++) if ((im.data[(y * im.width + x) * 4] ?? 255) < 160) n++;
  return n;
};

describe("caption font assets (HEY-44)", () => {
  for (const id of CAPTION_FONT_IDS)
    for (const w of supportedWeights(id))
      it(`${CAPTION_FONTS[id].label} ${w}: the shipped file covers Cyrillic (Ё Й І ї ў Є Ґ), Latin and combining marks, and is that family and weight`, () => {
        const f = file(CAPTION_FONTS[id].faces[w] ?? "");
        expect(existsSync(f)).toBe(true);
        const ttf = readTtf(new Uint8Array(readFileSync(f)));
        const missing = [...new Set([...MIXED.replace(/\n/g, ""), ..."ЁЙІїўЄєҐґЩЖЮЯ€«»—"])]
          .map((c) => c.codePointAt(0) ?? 0)
          .filter((c) => !ttf.codePoints.has(c))
          .map((c) => `U+${c.toString(16).toUpperCase()}`);
        expect(missing).toEqual([]);
        expect(ttf.family).toBe(CAPTION_FONTS[id].family);
        expect(ttf.weight).toBe(w);
      });

  it("every family keeps its licence next to the files", () => {
    for (const lic of ["Onest", "Literata", "GolosText", "Prata", "Caveat", "IBMPlexMono", "DMSans"])
      expect(readFileSync(file(`OFL-${lic}.txt`), "utf8")).toContain("SIL OPEN FONT LICENSE");
  });
});

describe("caption font selection (HEY-44)", () => {
  it("the default stays the first slot at Bold; older drafts without a font get it", () => {
    const layout = designToLayout(design({}));
    expect([layout.caption.font, layout.caption.weight, layout.caption.fontFamily]).toEqual(["dm", 700, "'HeyQR Onest', sans-serif"]);
    const old = readDraftDesign({ ...serializeDraftDesign(design({})), captionFont: undefined, captionWeight: undefined }, DEFAULT_DESIGN);
    expect(old.ok && designToLayout(old.value).caption.font).toBe("dm");
  });

  it("a font without the chosen weight uses the nearest one it ships (never a synthetic bold)", () => {
    expect(supportedWeights("instrument")).toEqual([400]);
    expect(designToLayout(design({ captionFont: "instrument", captionWeight: 700 })).caption.weight).toBe(400);
    expect(captionWeightFor("mono", 500)).toBe(500);
  });

  it("font and weight survive the draft round trip and the saved layout record", () => {
    const d = design({ captionFont: "fraunces", captionWeight: 500 });
    const read = readDraftDesign(JSON.parse(JSON.stringify(serializeDraftDesign(d))), DEFAULT_DESIGN);
    expect(read.ok && [read.value.captionFont, read.value.captionWeight]).toEqual(["fraunces", 500]);
    const record = readLayoutRecord({ schemaVersion: 1, layout: designToLayout(d), editor: designSettingsOf(d) });
    expect(record.ok && [record.value.layout.caption.font, record.value.editor?.captionFont, record.value.editor?.captionWeight]).toEqual([
      "fraunces",
      "fraunces",
      500,
    ]);
  });

  it("an unknown font ID in a saved layout is refused, not drawn with a wrong font", () => {
    const layout = { ...designToLayout(design({})), caption: { ...designToLayout(design({})).caption, font: "comic" } };
    expect(readLayoutRecord({ schemaVersion: 1, layout }).ok).toBe(false);
  });

  it("layouts saved before HEY-44 (no font ID) still render in DM Sans exactly as before", () => {
    const legacy: Layout = { ...designToLayout(design({ caption: "Scan me" })) };
    legacy.caption = { ...legacy.caption, font: undefined, fontFamily: "DM Sans, sans-serif", weight: 700 };
    const svg = composeLayout(legacy, VALUE).svg;
    expect(svg).toContain(`<text font-family="DM Sans, sans-serif"`);
    expect(svg).toContain(`style="font-variation-settings:'opsz' 14"`);
    expect(captionFontFaces(legacy).map((f) => path.basename(f.file))).toEqual(["DMSans-Bold.ttf"]);
  });
});

describe("caption fonts in exported files (HEY-44)", () => {
  for (const id of CAPTION_FONT_IDS)
    for (const w of supportedWeights(id))
      it(`${CAPTION_FONTS[id].label} ${w}: SVG embeds exactly the faces used, the PNG is drawn with them, and the code decodes`, async () => {
        const layout = designToLayout(design({ captionFont: id, captionWeight: w }));
        const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
        expect(svg).toContain(`<text font-family="${captionFontFamily(CAPTION_FONTS[id])}"`);
        // Embedded faces: first line at the chosen weight, second line at Regular; byte-for-byte the shipped files.
        const embedded = [...svg.matchAll(/font-weight:(\d+);font-style:normal;src:url\(data:font\/ttf;base64,([^)]+)\)/g)];
        const weights = [...new Set([w, 400])];
        expect(embedded.map((m) => Number(m[1])).sort()).toEqual(weights.sort());
        for (const m of embedded)
          expect(m[2]).toBe(readFileSync(file(CAPTION_FONTS[id].faces[Number(m[1]) as 400] ?? "")).toString("base64"));
        // The PNG uses the selected face: identical to a render that has only these files and no system fonts.
        const png = (await renderExport(layout, VALUE, "png", { scale: 2 })).body;
        const sized = svg.replace(/^<svg ([^>]*?)width="[^"]*" height="[^"]*"/, '<svg $1width="1024" height="1250"');
        const onlySelected = rasterizeSvg(sized, { width: 1024, fontFiles: captionFontFaces(layout).map((f) => f.file) });
        expect(ink(png)).toBe(ink(onlySelected));
        expect(ink(png)).toBeGreaterThan(1500);
        expect(await decodeImage(new Uint8Array(png))).toBe(VALUE);
      });

  it("different fonts draw differently (the face actually changes the artwork)", async () => {
    const inks = await Promise.all(
      CAPTION_FONT_IDS.map(async (id) =>
        ink((await renderExport(designToLayout(design({ captionFont: id })), VALUE, "png", { scale: 2 })).body),
      ),
    );
    expect(new Set(inks).size).toBe(CAPTION_FONT_IDS.length);
  });
});
