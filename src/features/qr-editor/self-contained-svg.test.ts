import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport, CAPTION_FONT_DIR } = await import("@/server/qr/export");

/*
 * HEY-48: a downloaded SVG must draw its caption with nothing but itself: no app stylesheet, no network, no installed
 * fonts. These checks fail if the caption ever depends on any of them.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const styled: EditorDesign = {
  ...DEFAULT_DESIGN,
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  preset: "caption",
  caption: "Сканируйте меню у стойки · Ёлка Йод Ії ўсё · Little Fern Café\nСтолик 4 · Table 4",
  captionFont: "fraunces",
  captionWeight: 500,
  captionAlign: "right",
  captionColor: "#8C2F4B",
  captionSize: 44,
  size: { unit: "px", qr: 900, width: 1080, height: 1300 },
};
// A layout saved before caption fonts (no font ID): the DM Sans family string.
const legacyLayout = (() => {
  const l = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "View the menu\nLittle Fern Café" });
  return { ...l, caption: { ...l.caption, font: undefined, fontFamily: "DM Sans, sans-serif", weight: 700 } };
})();
const cases = [
  ["wrapped Cyrillic + Latin, Literata Medium, right, custom colour", designToLayout(styled)],
  ["legacy layout without a font selection (DM Sans)", legacyLayout],
] as const;

const tmp = mkdtempSync(path.join(tmpdir(), "hey48-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The fonts a file carries, written out as files: family, weight and bytes, from its @font-face data URLs. */
function embeddedFonts(svg: string) {
  return [
    ...svg.matchAll(/@font-face\{font-family:'([^']+)';font-weight:(\d+);font-style:normal;src:url\(data:font\/ttf;base64,([^)]+)\)/g),
  ].map((m, i) => {
    const file = path.join(tmp, `${i}-${m[1]?.replace(/\W/g, "")}-${m[2]}.ttf`);
    writeFileSync(file, Buffer.from(m[3] ?? "", "base64"));
    return { family: m[1] ?? "", weight: Number(m[2]), file, bytes: m[3] ?? "" };
  });
}
describe("downloaded SVG is self-contained (HEY-48)", () => {
  for (const [name, layout] of cases)
    it(`${name}: no external resources or classes, every face it draws with is embedded, and it renders identically with no system fonts`, async () => {
      const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      // Nothing outside the file: no links, imports, remote URLs or classes that a stylesheet would have to style.
      expect(svg).not.toMatch(/<link|@import|url\((?!data:)|href="(?!data:|#)|class="/);
      // Each line's family and weight resolves to a face embedded byte-for-byte from the shipped font files.
      const fonts = embeddedFonts(svg);
      const family = svg
        .match(/<text font-family="([^"]+)"/)?.[1]
        ?.split(",")[0]
        ?.replace(/'/g, "")
        .trim();
      const weights = [...new Set([...svg.matchAll(/<tspan [^>]*font-weight="(\d+)"/g)].map((m) => Number(m[1])))];
      expect(weights.length).toBeGreaterThan(0);
      for (const w of weights) {
        const f = fonts.find((x) => x.family === family && x.weight === w);
        expect(f, `${family} ${w} embedded`).toBeDefined();
        expect(shippedFile(f?.bytes ?? ""), `${family} ${w} is a shipped font file`).not.toBeNull();
      }
      // Rendering with nothing but the file's own fonts gives exactly the exported artwork.
      const width = Number(svg.match(/^<svg [^>]*width="([\d.]+)"/)?.[1] ?? 512);
      const ownFontsOnly = rasterizeSvg(svg, { width, fontFiles: fonts.map((x) => x.file), systemFonts: false });
      const exported = (await renderExport(layout, VALUE, "png", { scale: 1 })).body;
      expect(Buffer.compare(ownFontsOnly, exported)).toBe(0);
      // Without its embedded fonts the caption would not draw: proof the check above depends on them.
      expect(Buffer.compare(rasterizeSvg(svg, { width, systemFonts: false }), ownFontsOnly)).not.toBe(0);
      // The rasterized download still decodes to the original payload.
      expect(await decodeImage(new Uint8Array(ownFontsOnly))).toBe(VALUE);
    }, 30_000);
});

/** Which shipped file the embedded bytes are (null when they match none): the export embeds the real assets. */
function shippedFile(base64: string): string | null {
  for (const f of readdirSync(CAPTION_FONT_DIR).filter((x) => x.endsWith(".ttf")))
    if (readFileSync(path.join(CAPTION_FONT_DIR, f)).toString("base64") === base64) return f;
  return null;
}
