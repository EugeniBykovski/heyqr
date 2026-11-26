import { describe, expect, it, vi } from "vitest";
import { decodeImage } from "@heyqr/qr-core/verify";
import { DEFAULT_DESIGN, designToLayout, presetSize } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("./export");
const { withResolution } = await import("@heyqr/qr-core/raster");

/* HEY-180: a print PNG says its dpi (pHYs), so layout and print software place it at its physical size. */
const VALUE = "https://littlefern.cafe/menu";
const chunks = (png: Buffer) => {
  const out: { type: string; data: Buffer }[] = [];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p);
    out.push({ type: png.toString("ascii", p + 4, p + 8), data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
};
const physical = (png: Buffer) => {
  const c = chunks(png).find((x) => x.type === "pHYs");
  return c ? { x: c.data.readUInt32BE(0), y: c.data.readUInt32BE(4), unit: c.data[8] } : null;
};
const card = designToLayout({
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Little Fern",
  size: { unit: "mm", qr: 36, width: 90, height: 50 },
});

describe("print PNG resolution (HEY-180)", () => {
  it("each dpi is written as pixels per metre, placed after IHDR and before IDAT; the code still decodes", async () => {
    for (const dpi of [300, 600, 1200]) {
      const file = await renderExport(card, VALUE, "png", { dpi });
      const png = Buffer.from(file.body);
      expect(physical(png), `${dpi} dpi`).toEqual({ x: Math.round(dpi / 0.0254), y: Math.round(dpi / 0.0254), unit: 1 });
      const order = chunks(png).map((c) => c.type);
      expect(order.indexOf("pHYs")).toBe(1);
      expect(order.indexOf("pHYs")).toBeLessThan(order.indexOf("IDAT"));
      // The physical size the file states is the layout's: pixels ÷ (pixels per mm).
      const ihdr = chunks(png)[0]?.data;
      expect(((ihdr?.readUInt32BE(0) ?? 0) / Math.round(dpi / 0.0254)) * 1000).toBeCloseTo(90, 0);
      if (dpi === 300) expect(await decodeImage(new Uint8Array(png))).toBe(VALUE);
    }
  });

  it("the default print export is 300 dpi; screen layouts carry no physical size", async () => {
    expect(physical(Buffer.from((await renderExport(card, VALUE, "png", {})).body))?.x).toBe(11811);
    const screen = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Hi", size: presetSize(1080, 1080) });
    expect(physical(Buffer.from((await renderExport(screen, VALUE, "png", { scale: 1 })).body))).toBeNull();
  });

  it("the chunk's CRC is valid and an existing pHYs is replaced, not duplicated", async () => {
    const png = Buffer.from((await renderExport(card, VALUE, "png", { dpi: 300 })).body);
    const again = withResolution(png, 600);
    expect(chunks(again).filter((c) => c.type === "pHYs")).toHaveLength(1);
    expect(physical(again)?.x).toBe(23622);
    // CRC over type + data, as PNG decoders check it.
    const p = again.indexOf("pHYs") - 4;
    const { crc32 } = await import("node:zlib");
    expect(again.readUInt32BE(p + 17)).toBe(crc32(again.subarray(p + 4, p + 17)));
  });
});
