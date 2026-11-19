import { CAPTION_FONT_IDS, captionFaceFile, composeLayout, layoutCaptionLines, layoutGeometry, measureCaptionText } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, ORIGINAL_CAPTION_FONT, type EditorDesign } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-55: Vertical and Horizontal cards against the design's references (Composition compose(), card presets):
 *   Vertical card 55 × 85 mm, 41 mm code: top band 6 % of H, caption band 19 % of H; code centred in the middle;
 *     caption box x 8 %, width 84 %, 90 % of the band. Caption 12 pt, centred.
 *   Horizontal card 90 × 50 mm, 35 mm code: padding (H − code) / 2 around the code on the left; caption box from
 *     padding × 0.8 right of the code to padding × 1.2 from the edge, as tall as the code. Caption 14 pt, left.
 * Both: background over the whole card with rounded corners (6 % of the shorter side) and a border.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const BG = "#F7F1E6";
const LONG = "Сканируйте меню у стойки · Ёлка Йод Ії ўсё · Little Fern Café\nСтолик 4 · Table 4";
const card = (preset: "vertical" | "horizontal", p: Partial<EditorDesign> = {}): EditorDesign => ({
  ...DEFAULT_DESIGN,
  bg: BG,
  fg: "#1F4D3A",
  preset,
  caption: "View portfolio",
  captionFont: "dm",
  size: { unit: "mm", qr: preset === "vertical" ? 41 : 35, width: 50, height: 62 },
  ...p,
});
const r3 = (v: number) => Math.round(v * 1000) / 1000;

describe("card geometry matches the design (HEY-55)", () => {
  it("Vertical card at the design's 41 mm code: 55 × 85 mm, code, caption band and defaults", () => {
    const layout = designToLayout(card("vertical"));
    expect([layout.width, layout.height]).toEqual([55, 85]);
    const g = layoutGeometry(layout);
    const H = 85;
    const hb = H * 0.06;
    const cb = H * 0.19;
    const mid = H - hb - cb;
    expect(g.qr.map(r3)).toEqual([7, hb + (mid - 41) / 2, 41].map(r3));
    expect(g.caption?.map(r3)).toEqual([55 * 0.08, H - cb, 55 * 0.84, cb * 0.9].map(r3));
    expect([layout.caption.size, layout.caption.align]).toEqual([12, "center"]);
  });

  it("Horizontal card at the design's 35 mm code: 90 × 50 mm, code on the left, caption beside it, left-aligned 14 pt", () => {
    const layout = designToLayout(card("horizontal"));
    expect([layout.width, layout.height]).toEqual([90, 50]);
    const g = layoutGeometry(layout);
    const pad = (50 - 35) / 2;
    expect(g.qr.map(r3)).toEqual([pad, pad, 35]);
    expect(g.caption?.map(r3)).toEqual([pad + 35 + pad * 0.8, pad, 90 - 35 - pad * 3, 35].map(r3));
    expect([r3(layout.caption.size), layout.caption.align]).toEqual([14, "left"]);
  });

  it("a chosen alignment or size is kept when switching between the cards", () => {
    const d = card("vertical", { captionAlign: "right", captionSize: 9 });
    const h = designToLayout({ ...d, preset: "horizontal" });
    expect([h.caption.align, h.caption.size]).toEqual(["right", 9]);
  });

  for (const preset of ["vertical", "horizontal"] as const)
    it(`${preset}: the background covers the whole card under a border, with rounded corners`, () => {
      const layout = designToLayout(card(preset));
      const svg = composeLayout(layout, VALUE).svg;
      const rect = svg.match(
        /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)" fill="([^"]+)" stroke="([^"]+)" stroke-width="([\d.]+)"/,
      );
      expect(rect?.[6]).toBe(BG);
      const bw = Number(rect?.[8]);
      expect([Number(rect?.[1]), Number(rect?.[2])]).toEqual([bw / 2, bw / 2].map(r3));
      expect(Number(rect?.[3])).toBeCloseTo(layout.width - bw, 3);
      expect(Number(rect?.[4])).toBeCloseTo(layout.height - bw, 3);
      expect(Number(rect?.[5])).toBeCloseTo(Math.min(layout.width, layout.height) * 0.06, 3);
    });
});

describe("a long caption on each card (HEY-55)", () => {
  for (const [preset, size] of [
    ["vertical", { unit: "px", qr: 1080, width: 1080, height: 1080 }],
    ["horizontal", { unit: "px", qr: 1080, width: 1080, height: 1080 }],
    ["vertical", { unit: "mm", qr: 41, width: 41, height: 41 }],
    ["horizontal", { unit: "mm", qr: 35, width: 35, height: 35 }],
  ] as const)
    it(`${preset} · ${size.unit}: wrapped and fitted inside its caption box, clear of the code, nothing clipped`, async () => {
      const layout = designToLayout(card(preset, { caption: LONG, captionAlign: preset === "horizontal" ? "left" : "center", size }));
      const g = layoutGeometry(layout);
      const box = g.caption ?? [0, 0, 0, 0];
      const { fs, lines } = layoutCaptionLines(layout, g);
      expect(lines.length).toBeGreaterThan(2); // the long line wraps
      for (const l of lines)
        expect(measureCaptionText(l.text, captionFaceFile("dm", l.secondary ? 400 : 700), l.size)).toBeLessThanOrEqual(
          box[2] * 0.94 + 1e-6,
        );
      expect(1.18 * lines.reduce((s, l) => s + l.size, 0)).toBeLessThanOrEqual(box[3] * 0.86 + 1e-6);
      expect(fs).toBeGreaterThan(0);
      // The caption box never overlaps the code (and its quiet zone, which is inside the code's square).
      const [qx, qy, q] = g.qr;
      const overlaps = box[0] < qx + q && box[0] + box[2] > qx && box[1] < qy + q && box[1] + box[3] > qy;
      expect(overlaps).toBe(false);
      // In the PNG: caption-coloured ink only inside the caption box, none on the code.
      const res = size.unit === "px" ? { scale: 1 } : { dpi: 300 };
      const png = readPng(new Uint8Array((await renderExport(layout, VALUE, "png", res)).body));
      const k = png.width / layout.width;
      let inkOutside = 0;
      let ink = 0;
      for (let y = 0; y < png.height; y++)
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4;
          const [r, gg, b] = [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
          const isCaption = Math.abs(r - 0x1f) < 40 && Math.abs(gg - 0x4d) < 40 && Math.abs(b - 0x3a) < 40; // #1F4D3A
          const inCode = x >= qx * k - 1 && x <= (qx + q) * k + 1 && y >= qy * k - 1 && y <= (qy + q) * k + 1;
          if (!isCaption || inCode) continue;
          // the border is the same colour: skip the outer 2 % of the card
          if (x < png.width * 0.02 || x > png.width * 0.98 || y < png.height * 0.02 || y > png.height * 0.98) continue;
          ink++;
          if (x < box[0] * k - 2 || x > (box[0] + box[2]) * k + 2 || y < box[1] * k - 2 || y > (box[1] + box[3]) * k + 2) inkOutside++;
        }
      expect(ink).toBeGreaterThan(200);
      expect(inkOutside).toBe(0);
      expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", res)).body))).toBe(VALUE);
    }, 30_000);
});

describe("export sizes and decoding (HEY-55)", () => {
  for (const [name, d, res, root, png] of [
    ["Vertical card · Print 41 mm at 300 dpi", card("vertical"), { dpi: 300 }, ["55mm", "85mm"], [650, 1004]],
    ["Horizontal card · Print 35 mm at 300 dpi", card("horizontal"), { dpi: 300 }, ["90mm", "50mm"], [1063, 591]],
    [
      "Vertical card · Screen 484 px at 2×",
      card("vertical", { size: { unit: "px", qr: 484, width: 484, height: 484 } }),
      { scale: 2 },
      ["649", "1003"], // card from the code: 484 × 55/41, 484 × 85/41
      [1298, 2006],
    ],
    [
      "Horizontal card · Screen 413 px at 2×",
      card("horizontal", { size: { unit: "px", qr: 413, width: 413, height: 413 } }),
      { scale: 2 },
      ["1062", "590"],
      [2124, 1180],
    ],
  ] as const)
    it(
      name,
      async () => {
        const layout = designToLayout(d);
        const svg = (await renderExport(layout, VALUE, "svg", res)).body.toString();
        expect(svg.match(/^<svg [^>]*width="([^"]+)" height="([^"]+)"/)?.slice(1, 3)).toEqual(root);
        const file = (await renderExport(layout, VALUE, "png", res)).body;
        expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual(png);
        expect(await decodeImage(new Uint8Array(file))).toBe(VALUE);
        expect(await decodeImage(rasterizeSvg(svg, { width: 1200 }))).toBe(VALUE);
      },
      30_000,
    );
});

describe("words stay whole in narrow caption areas (HEY-55)", () => {
  const words = (s: string) => s.split(/\s+/).filter(Boolean);
  it("the horizontal card's narrow column shrinks the caption instead of breaking an ordinary word, in every caption font", () => {
    // The original DM Sans (older layouts) has no Cyrillic, so its Cyrillic is measured wide: that is where a word split
    // used to happen ("Сканируйт / е").
    for (const captionFont of [ORIGINAL_CAPTION_FONT, ...CAPTION_FONT_IDS])
      for (const size of [
        { unit: "px", qr: 512, width: 512, height: 512 },
        { unit: "mm", qr: 35, width: 35, height: 35 },
      ] as const) {
        const layout = designToLayout(card("horizontal", { caption: LONG, captionFont, size }));
        const { lines } = layoutCaptionLines(layout, layoutGeometry(layout));
        const all = new Set(words(LONG));
        for (const l of lines) for (const w of words(l.text)) expect(all.has(w), `${captionFont} ${size.unit}: "${w}"`).toBe(true);
      }
  });

  it("a genuinely unbroken token (HEY-47 print sample) still splits between graphemes, and nothing else does", () => {
    const token = "Супердлинноеназваниебезпробелов·Ё̈Йод";
    const layout = designToLayout({
      ...DEFAULT_DESIGN,
      preset: "caption",
      caption: `${token}\nScan for the seasonal menu · Café`,
      captionFont: "dm",
      captionWeight: 500,
      captionAlign: "right",
      captionSize: 12,
      size: { unit: "mm", qr: 40, width: 50, height: 66 },
    });
    const { lines } = layoutCaptionLines(layout, layoutGeometry(layout));
    const title = lines.filter((l) => !l.secondary).map((l) => l.text);
    expect(title.length).toBeGreaterThan(1);
    expect(title.join("")).toBe(token);
    expect(lines.filter((l) => l.secondary).flatMap((l) => words(l.text))).toEqual(words("Scan for the seasonal menu · Café"));
  });
});
