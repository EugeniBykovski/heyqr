import { composeLayout, encodePayload, layoutGeometry, measureCaptionText, captionFaceFile, normalizeUrl } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";

/* HEY-65: long website URLs in narrow layouts. */
const LONG =
  "littlefern.cafe/menu/seasonal-specials-autumn-winter-collection-2026-hand-roasted-single-origin-ethiopia-yirgacheffe-natural-process?table=12&utm_source=print&utm_medium=qr&utm_campaign=autumn-menu-2026#oat-flat-white";
const CAPTION = "littlefern.cafe/menu/seasonal-specials-autumn-2026-yirgacheffe?table=12#oat";
const narrowCard = (caption: string): EditorDesign => ({
  ...DEFAULT_DESIGN,
  content: { type: "website", url: LONG },
  preset: "vertical",
  caption,
  size: { unit: "mm", qr: 43.3, width: 43.3, height: 52.9 },
});

const lines = (svg: string) =>
  [...svg.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/tspan>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    fs: Number(m[3]),
    text: m[4] ?? "",
  }));

describe("long website URLs (HEY-65)", () => {
  it("the payload keeps the whole address — path, query and fragment — and the artwork decodes to it", async () => {
    const value = encodePayload({ type: "website", url: LONG });
    expect(value).toBe(normalizeUrl(LONG));
    expect(value).toBe(`https://${LONG}`);
    const { svg } = composeLayout(designToLayout(narrowCard("Scan me")), value);
    expect(await decodeImage(rasterizeSvg(svg, { width: 1400 }))).toBe(value);
  }, 30_000);

  it("a long unbroken URL caption on a narrow mm card wraps inside its box, clear of the code; the card keeps its size", () => {
    const layout = designToLayout(narrowCard(CAPTION));
    const g = layoutGeometry(layout);
    const box = g.caption;
    if (!box) throw new Error("no caption box");
    const drawn = lines(composeLayout(layout, normalizeUrl(LONG)).svg);
    expect(drawn.map((l) => l.text).join("")).toBe(CAPTION);
    const file = captionFaceFile(layout.caption.font, layout.caption.weight);
    for (const l of drawn) {
      const w = measureCaptionText(l.text, file, l.fs);
      // Centred lines stay within the caption box, and below the code with its quiet zone.
      expect(l.x - w / 2).toBeGreaterThanOrEqual(box[0] - 1e-6);
      expect(l.x + w / 2).toBeLessThanOrEqual(box[0] + box[2] + 1e-6);
      expect(l.y - l.fs).toBeGreaterThanOrEqual(g.qr[1] + g.qr[2]);
      expect(l.y).toBeLessThanOrEqual(box[1] + box[3]);
    }
    const short = layoutGeometry(designToLayout(narrowCard("Scan me")));
    expect([g.width, g.height, g.qr]).toEqual([short.width, short.height, short.qr]);
  });

  it("a normal caption is unchanged: one line at its chosen size", () => {
    const layout = designToLayout(narrowCard("Scan me"));
    const drawn = lines(composeLayout(layout, normalizeUrl(LONG)).svg);
    expect(drawn.map((l) => l.text)).toEqual(["Scan me"]);
  });
});
