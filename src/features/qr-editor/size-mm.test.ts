import { encodeQr } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import {
  convertSize,
  DEFAULT_DESIGN,
  designSettingsOf,
  designToLayout,
  parseSizeValue,
  presetSize,
  type DesignSize,
  type EditorDesign,
} from "@/entities/qr";
import { createLayoutRecord, readDraftDesign, readLayoutRecord } from "@/entities/qr/model/design-schema";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
// The shared export path behind GET /api/export/[layoutId] (after auth and entitlement checks).
const { renderExport } = await import("@/server/qr/export");

/* HEY-36: Print (mm) sizes become the physical width/height of the exported SVG. */
const VALUE = "https://littlefern.cafe/menu?table=4";
const V = encodeQr(VALUE, "M").size + 8; // symbol viewBox: modules + 2 × 4 quiet-zone modules (37 here)
const PALETTE = { fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" };
const mm = (qr: number, width = qr, height = qr): DesignSize => ({ unit: "mm", qr, width, height });

type Case = { name: string; design: EditorDesign; root: [string, string]; viewBox: string; qr: number };
const CASES: Case[] = [
  {
    name: "QR only · 40 mm",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "qr", size: mm(40) },
    root: ["40mm", "40mm"],
    viewBox: "0 0 40 40",
    qr: 40,
  },
  {
    name: "QR only · 25.5 mm",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "qr", size: mm(25.5) },
    root: ["25.5mm", "25.5mm"],
    viewBox: "0 0 25.5 25.5",
    qr: 25.5,
  },
  // Bar frame: 1.14 × 1.44 of the code (design FRAME_K.bar), so 45.6 × 57.6 mm around a 40 mm code.
  {
    name: "framed (bar) · 40 mm code",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "frame", frameStyle: "bar", caption: "Scan for the menu", size: mm(40) },
    root: ["45.6mm", "57.6mm"],
    viewBox: "0 0 45.6 57.6",
    qr: 40,
  },
  {
    name: "framed (bar) · 25.5 mm code",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "frame", frameStyle: "bar", caption: "Scan for the menu", size: mm(25.5) },
    root: ["29.07mm", "36.72mm"],
    viewBox: "0 0 29.07 36.72",
    qr: 25.5,
  },
  // Caption layout with its own canvas: the A6 preset, the code 72 % of the short side (105 × 0.72 = 75.6 → 76 mm).
  {
    name: "captioned · A6 105 × 148 mm",
    design: { ...DEFAULT_DESIGN, ...PALETTE, preset: "caption", caption: "Scan me", size: presetSize(105, 148, "mm") },
    root: ["105mm", "148mm"],
    viewBox: "0 0 105 148",
    qr: 76,
  },
];

describe("Print sizes in the exported SVG and PNG (HEY-36)", () => {
  for (const c of CASES)
    it(`${c.name}: root ${c.root.join(" × ")}, viewBox "${c.viewBox}", code ${c.qr} mm with its quiet zone`, async () => {
      const layout = designToLayout(c.design);
      const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      expect((await renderExport(layout, VALUE, "svg", {})).body.toString()).toBe(svg);
      const root = svg.match(/^<svg xmlns="[^"]+" width="([^"]+)" height="([^"]+)" viewBox="([^"]+)">/);
      expect(root?.slice(1, 4)).toEqual([...c.root, c.viewBox]);
      // The symbol keeps its own viewBox (the matrix) and is c.qr mm wide in the layout, quiet zone included.
      const nested = svg.match(/<svg x="[^"]+" y="[^"]+" width="([^"]+)" height="([^"]+)" viewBox="0 0 (\d+) (\d+)">/);
      expect(nested?.slice(1, 5).map(Number)).toEqual([c.qr, c.qr, V, V]);
      // Non-default palette reaches the file.
      for (const fill of [PALETTE.bg, PALETTE.fg, PALETTE.eye, PALETTE.eyeIn]) expect(svg).toContain(`fill="${fill}"`);

      // PNG: unchanged behaviour, 300 dpi of the physical width.
      const png = (await renderExport(layout, VALUE, "png", {})).body;
      const img = readPng(new Uint8Array(png));
      const widthMm = parseFloat(c.root[0]);
      expect(img.width).toBe(Math.round((widthMm / 25.4) * 300));
      expect(await decodeImage(new Uint8Array(png)), `exported PNG (${img.width} px)`).toBe(VALUE);
      expect(await decodeImage(rasterizeSvg(svg, { width: 800 })), "exported SVG rasterized at 800 px").toBe(VALUE);
    });

  it("a print draft and a saved variant restore their size; older drafts keep the legacy px size", () => {
    const design: EditorDesign = { ...DEFAULT_DESIGN, preset: "frame", size: mm(25.5) };
    const draft = readDraftDesign(JSON.parse(JSON.stringify({ schemaVersion: 1, ...design })), DEFAULT_DESIGN);
    expect(draft.ok && draft.value.size).toEqual(mm(25.5));
    const record = readLayoutRecord(JSON.parse(JSON.stringify(createLayoutRecord(designToLayout(design), designSettingsOf(design)))));
    expect(record.ok && [record.value.layout.unit, record.value.layout.qrSize, record.value.editor?.size]).toEqual(["mm", 25.5, mm(25.5)]);
    const legacy = readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN }, DEFAULT_DESIGN);
    expect(legacy.ok && [legacy.value.size, designToLayout(legacy.value).unit, designToLayout(legacy.value).qrSize]).toEqual([
      undefined,
      "px",
      512,
    ]);
  });

  it("invalid print dimensions can't reach the renderer", () => {
    for (const [text, field] of [
      ["25.55", "qr"],
      ["9.9", "qr"],
      ["200.1", "qr"],
      ["25,5", "qr"],
      ["", "qr"],
      ["501", "width"],
    ] as const)
      expect(parseSizeValue(text, "mm", field), `${field} ${text}`).toBeNull();
    expect(parseSizeValue("25.5", "mm", "qr")).toBe(25.5);
    for (const bad of [mm(25.55), mm(5), mm(40, 600, 40)])
      expect(readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN, size: bad }, DEFAULT_DESIGN).ok, JSON.stringify(bad)).toBe(false);
  });

  it("switching units keeps physical proportions (300 dpi) and the px export still works as before", async () => {
    expect(convertSize({ unit: "px", qr: 512, width: 512, height: 625 }, "mm")).toEqual({
      unit: "mm",
      qr: 43.3,
      width: 43.3,
      height: 52.9,
    });
    expect(convertSize(mm(40), "px")).toEqual({ unit: "px", qr: 472, width: 472, height: 472 });
    const px = (await renderExport(designToLayout({ ...DEFAULT_DESIGN, preset: "qr" }), VALUE, "svg", {})).body.toString();
    expect(px).toMatch(/^<svg [^>]*width="512" height="512" viewBox="0 0 512 512"/);
  });
});
