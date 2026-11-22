import { composeLayout, encodeQr, layoutGeometry, type Layout } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import {
  CARD_RATIO,
  createLayoutRecord,
  DEFAULT_DESIGN,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  EDITOR_PRESETS,
  type EditorDesign,
} from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-53: QR only and the four design layouts (QR only, QR + caption, Vertical card, Horizontal card) plus Frame, all
 * selectable in the editor and drawn by the shared renderer.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const LOGO = `data:image/png;base64,${rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#C8102E"/></svg>`, { width: 64 }).toString("base64")}`;
const styled: EditorDesign = {
  ...DEFAULT_DESIGN,
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  pattern: "dot",
  eyeFrame: "circle",
  eyeBall: "circle",
  logo: { kind: "image", href: LOGO },
  logoSize: 0.22,
  logoPlate: "circle",
  caption: "Сканируйте меню · Little Fern Café\nTable 4",
  captionFont: "fraunces",
  captionWeight: 500,
  captionAlign: "left",
  captionColor: "#8C2F4B",
  captionSize: 40,
  frameStyle: "bubble",
  size: { unit: "px", qr: 1080, width: 1200, height: 1500 },
};

describe("QR only (HEY-53)", () => {
  it("is a square canvas the size of the code: the symbol with its quiet zone fills it, nothing else is drawn", async () => {
    const layout = designToLayout({ ...styled, preset: "qr" });
    expect([layout.width, layout.height]).toEqual([1080, 1080]);
    const g = layoutGeometry(layout);
    expect(g.qr).toEqual([0, 0, 1080]);
    const { svg } = composeLayout(layout, VALUE);
    const modules = encodeQr(VALUE, "H").size;
    expect(svg).toMatch(new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">`));
    expect(svg).toContain(`<svg x="0" y="0" width="1080" height="1080" viewBox="0 0 ${modules + 8} ${modules + 8}">`); // 4-module quiet zone each side
    expect(svg).not.toContain("<text"); // no caption
    expect(svg).not.toContain("stroke="); // no card border or frame
    expect(svg).toContain(`<image href="${LOGO}"`); // the centre logo stays
    // The quiet zone is background all round in the PNG.
    const png = readPng(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body));
    const q = Math.floor((4 / (modules + 8)) * 1080) - 1;
    for (const [x, y] of [
      [q, 540],
      [1080 - q, 540],
      [540, q],
      [540, 1080 - q],
      [q, q],
    ]) {
      const i = ((y ?? 0) * png.width + (x ?? 0)) * 4;
      expect([png.data[i], png.data[i + 1], png.data[i + 2]]).toEqual([0xf7, 0xf1, 0xe6]);
    }
  });

  it("switching layouts keeps every setting: QR only and the cards leave the caption and the QR + caption canvas as they were", () => {
    let d: EditorDesign = { ...styled, preset: "caption" };
    const captionLayout = designToLayout(d);
    for (const preset of ["qr", "vertical", "horizontal", "frame", "caption"] as const) d = { ...d, preset };
    expect(d).toEqual({ ...styled, preset: "caption" });
    expect(designToLayout(d)).toEqual(captionLayout);
  });

  it("is saved and reopened as QR only with its size and styling", () => {
    const d = { ...styled, preset: "qr" as const };
    const record = createLayoutRecord(designToLayout(d), designSettingsOf(d));
    if (!record) throw new Error("refused");
    const reopened = designFromSaved({ name: "Menu", model: "static", content: { type: "website", url: VALUE } }, record);
    expect([reopened.preset, reopened.size, reopened.pattern, reopened.eyeFrame, reopened.fg, reopened.bg, reopened.logoPlate]).toEqual([
      "qr",
      styled.size,
      "dot",
      "circle",
      "#1F4D3A",
      "#F7F1E6",
      "circle",
    ]);
    expect(reopened.caption).toBe(styled.caption); // kept for when another layout is chosen
  });

  for (const [mode, size, resolution, svgRoot, png] of [
    [
      "Screen 1080 px at 2×",
      { unit: "px", qr: 1080, width: 1080, height: 1080 },
      { scale: 2 },
      ["1080", "1080", "0 0 1080 1080"],
      [2160, 2160],
    ],
    ["Print 40 mm at 300 dpi", { unit: "mm", qr: 40, width: 40, height: 40 }, { dpi: 300 }, ["40mm", "40mm", "0 0 40 40"], [472, 472]],
    ["Print 40 mm at 600 dpi", { unit: "mm", qr: 40, width: 40, height: 40 }, { dpi: 600 }, ["40mm", "40mm", "0 0 40 40"], [945, 945]],
  ] as const)
    it(`exports at the right size: ${mode}`, async () => {
      const layout = designToLayout({ ...styled, preset: "qr", size });
      const svg = (await renderExport(layout, VALUE, "svg", resolution)).body.toString();
      expect(svg.match(/^<svg [^>]*width="([^"]+)" height="([^"]+)" viewBox="([^"]+)"/)?.slice(1, 4)).toEqual(svgRoot);
      const file = (await renderExport(layout, VALUE, "png", resolution)).body;
      expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual(png);
      expect(await decodeImage(new Uint8Array(file))).toBe(VALUE);
      expect(await decodeSvg(svg, 1000)).toBe(VALUE);
    });
});

describe("the same QR in every layout (HEY-53)", () => {
  it("offers QR only, QR + caption, Vertical card, Horizontal card and Frame", () => {
    expect(EDITOR_PRESETS).toEqual(["qr", "caption", "vertical", "horizontal", "frame"]);
  });

  for (const preset of EDITOR_PRESETS)
    it(`${preset}: scans, and its SVG and PNG decode to the same payload`, async () => {
      const layout: Layout = designToLayout({ ...styled, preset });
      if (preset === "vertical" || preset === "horizontal") {
        expect(layout.width).toBe(Math.round(1080 * CARD_RATIO[preset].width));
        expect(layout.height).toBe(Math.round(1080 * CARD_RATIO[preset].height));
        const g = layoutGeometry(layout);
        expect(g.caption).not.toBeNull();
        if (preset === "horizontal")
          expect(g.caption?.[0]).toBeGreaterThan(g.qr[0] + g.qr[2]); // caption beside the code
        else expect(g.caption?.[1]).toBeGreaterThan(g.qr[1] + g.qr[2] - 1); // caption under the code
        expect(composeLayout(layout, VALUE).svg).toContain('stroke="#1F4D3A"'); // the card's border
      }
      expect(composeLayout(layout, VALUE).scan.ok).toBe(true);
      const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      expect(await decodeSvg(svg, 1200)).toBe(VALUE);
      expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body))).toBe(VALUE);
    }, 30_000);
});
