// @vitest-environment node
import { layoutGeometry } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DESIGN,
  designSettingsOf,
  designToLayout,
  LEGACY_SIZE,
  parseSizeValue,
  presetSize,
  type EditorDesign,
} from "@/entities/qr";
import { createLayoutRecord, readDraftDesign, readLayoutRecord } from "@/entities/qr/model/design-schema";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/* HEY-35: screen (px) sizing — the size model, legacy behaviour, and the shared export path. */
const VALUE = "https://littlefern.cafe/menu?table=4";

describe("size rule (px)", () => {
  it.each([
    ["qr", "120", 120],
    ["qr", "2400", 2400],
    ["qr", " 1080 ", 1080],
    ["width", "4000", 4000],
  ] as const)("accepts %s = %j", (field, text, out) => expect(parseSizeValue(text, "px", field)).toBe(out));
  it.each([
    ["qr", ""],
    ["qr", "119"],
    ["qr", "2401"],
    ["qr", "512.5"],
    ["qr", "-512"],
    ["qr", "5e2"],
    ["qr", "512px"],
    ["width", "4001"],
    ["height", "0"],
  ] as const)("rejects %s = %j", (field, text) => expect(parseSizeValue(text, "px", field)).toBeNull());
});

describe("size → layout (px)", () => {
  it("drafts without a size keep exactly the legacy layout", () => {
    for (const preset of ["qr", "caption", "frame"] as const) {
      const l = designToLayout({ ...DEFAULT_DESIGN, preset, caption: "Scan me" });
      expect([l.unit, l.qrSize, l.caption.size]).toEqual(["px", 512, 40]);
      expect([l.width, l.height]).toEqual(preset === "caption" ? [512, 625] : [512, 512]);
    }
  });

  it("QR only: the canvas is the code; caption: its own canvas; frame: derived from the code", () => {
    const size = { unit: "px" as const, qr: 1080, width: 1920, height: 1080 };
    const qr = layoutGeometry(designToLayout({ ...DEFAULT_DESIGN, preset: "qr", size }));
    expect([qr.width, qr.height, qr.qr[2]]).toEqual([1080, 1080, 1080]);
    const cap = layoutGeometry(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me", size: presetSize(1080, 1920) }));
    expect([cap.width, cap.height, cap.qr[2]]).toEqual([1080, 1920, 780]);
    const frame = layoutGeometry(designToLayout({ ...DEFAULT_DESIGN, preset: "frame", frameStyle: "bar", caption: "Scan me", size }));
    expect(frame.qr[2]).toBe(1080);
    expect(frame.width).toBeCloseTo(1080 * 1.14, 6);
    // Caption type scales with the code (40 px at 512).
    expect(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", size }).caption.size).toBeCloseTo((40 * 1080) / 512, 6);
  });

  it("a saved draft and a saved variant keep their size; invalid sizes can't be restored", () => {
    const design: EditorDesign = { ...DEFAULT_DESIGN, preset: "caption", caption: "Hi", size: presetSize(1920, 1080) };
    const draft = readDraftDesign(JSON.parse(JSON.stringify({ schemaVersion: 1, ...design })), DEFAULT_DESIGN);
    expect(draft.ok && draft.value.size).toEqual({ unit: "px", qr: 780, width: 1920, height: 1080 });
    const record = readLayoutRecord(JSON.parse(JSON.stringify(createLayoutRecord(designToLayout(design), designSettingsOf(design)))));
    expect(record.ok && record.value.editor?.size).toEqual(design.size);
    expect(
      readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN, size: { unit: "px", qr: 50, width: 512, height: 625 } }, DEFAULT_DESIGN).ok,
    ).toBe(false);
    expect(
      readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN, size: { unit: "px", qr: 512.5, width: 512, height: 625 } }, DEFAULT_DESIGN).ok,
    ).toBe(false);
    expect(LEGACY_SIZE).toEqual({ unit: "px", qr: 512, width: 512, height: 625 });
  });
});

describe("px sizes through the shared export path (renderExport, behind /api/export)", () => {
  const CASES: [string, EditorDesign, [number, number]][] = [
    [
      "QR only 1080 px",
      { ...DEFAULT_DESIGN, preset: "qr", fg: "#1F4D3A", size: { unit: "px", qr: 1080, width: 1080, height: 1080 } },
      [1080, 1080],
    ],
    [
      "caption, Slide 1920×1080",
      { ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me", fg: "#1F4D3A", size: presetSize(1920, 1080) },
      [1920, 1080],
    ],
  ];
  for (const [name, design, [w, h]] of CASES)
    it(`${name}: SVG says ${w}×${h} px, PNG is 2×, both decode`, async () => {
      const layout = designToLayout(design);
      const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      expect(svg).toMatch(new RegExp(`^<svg [^>]*width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`));
      const png = (await renderExport(layout, VALUE, "png", {})).body;
      const img = readPng(new Uint8Array(png));
      expect([img.width, img.height]).toEqual([w * 2, h * 2]);
      expect(await decodeImage(new Uint8Array(png)), "exported PNG").toBe(VALUE);
      expect(await decodeImage(rasterizeSvg(svg, { width: w })), `rasterized SVG at ${w} px`).toBe(VALUE);
    });
});
