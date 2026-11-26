import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CAPTION_FONTS, captionFontSize, layoutGeometry } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-49 control fixtures: Cyrillic-only, accented Latin, a long mixed-script caption that wraps and is fitted, and a
 * two-line caption with unequal lines; screen (px) and print (mm) layouts, four font families, three weights,
 * non-default alignment and colour. For each, the downloaded SVG drawn with only its own embedded fonts at the PNG's
 * exact pixel size must be the downloaded PNG, byte for byte: any font substitution, line-break, size, alignment or
 * colour drift between the two files fails here.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const FIXTURES: [string, EditorDesign, { scale?: number; dpi?: number }][] = [
  [
    "Cyrillic only · screen · Literata Medium · center",
    {
      ...DEFAULT_DESIGN,
      preset: "caption",
      caption: "Ёлка Йод Іван ї ўсё — Жук",
      captionFont: "fraunces",
      captionWeight: 500,
      size: { unit: "px", qr: 900, width: 1080, height: 1300 },
    },
    { scale: 1 },
  ],
  [
    "accented Latin · print · Onest Bold · left · #1F4ED8",
    {
      ...DEFAULT_DESIGN,
      fg: "#1F4D3A",
      preset: "caption",
      caption: "Café menu · Crème brûlée",
      captionFont: "dm",
      captionWeight: 700,
      captionAlign: "left",
      captionColor: "#1F4ED8",
      size: { unit: "mm", qr: 40, width: 50, height: 62 },
    },
    { dpi: 300 },
  ],
  [
    "long mixed script, wrapped and fitted · screen · Golos Text Regular · right · #8C2F4B",
    {
      ...DEFAULT_DESIGN,
      bg: "#F7F1E6",
      preset: "caption",
      caption: "Сканируйте меню у стойки · Ёлка Йод Ії ўсё · Little Fern Café",
      captionFont: "grotesk",
      captionWeight: 400,
      captionAlign: "right",
      captionColor: "#8C2F4B",
      captionSize: 120,
      size: { unit: "px", qr: 900, width: 1080, height: 1300 },
    },
    { scale: 1 },
  ],
  [
    "manual break, unequal lines · print · IBM Plex Mono Medium · right · #C8102E",
    {
      ...DEFAULT_DESIGN,
      preset: "caption",
      caption: "Crème brûlée\nПирожное «Ёж» и кофе · Café au lait",
      captionFont: "mono",
      captionWeight: 500,
      captionAlign: "right",
      captionColor: "#C8102E",
      captionSize: 14,
      size: { unit: "mm", qr: 40, width: 60, height: 70 },
    },
    { dpi: 300 },
  ],
];

const tmp = mkdtempSync(path.join(tmpdir(), "hey49-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("Cyrillic and Latin captions: downloaded SVG and PNG agree (HEY-49)", () => {
  for (const [name, design, resolution] of FIXTURES)
    it(
      name,
      async () => {
        const layout = designToLayout(design);
        const svg = (await renderExport(layout, VALUE, "svg", resolution)).body.toString();
        const png = (await renderExport(layout, VALUE, "png", resolution)).body;
        const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];

        // The caption text survives intact: wrapped lines rebuild the input exactly (spaces at breaks, newlines kept).
        const tspans = [...svg.matchAll(/<tspan [^>]*font-size="([^"]+)" font-weight="(\d+)"[^>]*>([^<]*)<\/tspan>/g)];
        const secondaryFrom = tspans.findIndex((m) => m[0].includes("fill-opacity"));
        const title = (secondaryFrom < 0 ? tspans : tspans.slice(0, secondaryFrom)).map((m) => m[3]).join(" ");
        const rest = secondaryFrom < 0 ? [] : tspans.slice(secondaryFrom).map((m) => m[3]);
        expect([title, ...(rest.length ? [rest.join(" ")] : [])].join("\n").replace(/&#39;/g, "'")).toBe(design.caption);
        // The drawn size is the renderer's fitted size; the selected family and weights are embedded.
        // (the SVG writes sizes to three decimals)
        expect(Number(tspans[0]?.[1])).toBeCloseTo(captionFontSize(layout, layoutGeometry(layout)), 2);
        const family = CAPTION_FONTS[layout.caption.font ?? "dm"].family;
        expect(svg).toContain(`@font-face{font-family:'${family}';font-weight:${tspans[0]?.[2]}`);

        // Only the SVG's own fonts, no system fonts, at the PNG's exact size: identical to the downloaded PNG.
        const files = [...svg.matchAll(/src:url\(data:font\/ttf;base64,([^)]+)\)/g)].map((m, i) => {
          const f = path.join(tmp, `${name.length}-${i}.ttf`);
          writeFileSync(f, Buffer.from(m[1] ?? "", "base64"));
          return f;
        });
        const sized = svg.replace(
          /^<svg ([^>]*?)width="[^"]*" height="[^"]*"/,
          `<svg $1width="${w}" height="${h}" preserveAspectRatio="none"`,
        );
        // HEY-180: print PNGs also state their dpi (pHYs); the same metadata, so the comparison stays byte for byte.
        const dpi = layout.unit === "mm" ? (resolution.dpi ?? 300) : undefined;
        const fromSvg = rasterizeSvg(sized, { width: w, fontFiles: files, systemFonts: false, ...(dpi ? { dpi } : {}) });
        expect(Buffer.compare(fromSvg, png), "SVG drawn with its own fonts = PNG").toBe(0);

        expect(await decodeImage(new Uint8Array(png)), "downloaded PNG").toBe(VALUE);
        expect(await decodeImage(new Uint8Array(fromSvg)), "rasterized SVG").toBe(VALUE);
      },
      30_000,
    );
});
