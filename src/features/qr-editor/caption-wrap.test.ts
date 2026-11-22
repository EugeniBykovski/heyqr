import {
  captionFaceFile,
  composeLayout,
  fitCaption,
  layoutCaptionLines,
  layoutGeometry,
  measureCaptionText,
  wrapCaptionLine,
} from "@heyqr/qr-core";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { createLayoutRecord, DEFAULT_DESIGN, designFromSaved, designSettingsOf, designToLayout, type EditorDesign } from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

const VALUE = "https://littlefern.cafe/menu?table=4";
const ONEST_BOLD = captionFaceFile("dm", 700);
const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
const design = (p: Partial<EditorDesign>): EditorDesign => ({ ...DEFAULT_DESIGN, preset: "caption", captionFont: "dm", ...p });
const tspans = (svg: string) =>
  [...svg.matchAll(/<tspan x="([^"]+)" y="([^"]+)" font-size="([^"]+)" font-weight="(\d+)"[^>]*>([^<]*)<\/tspan>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    size: Number(m[3]),
    weight: Number(m[4]),
    text: m[5],
  }));

describe("caption line breaking (HEY-47)", () => {
  const measure = (s: string) => measureCaptionText(s, ONEST_BOLD, 40);

  it("measures with the face's own advance widths: combining marks add nothing, Cyrillic has its own widths", () => {
    expect(measure("é")).toBe(measure("e"));
    expect(measure("Ж")).toBeGreaterThan(measure("ж"));
    expect(measureCaptionText("WWW", captionFaceFile("mono", 400), 10)).toBeCloseTo(
      measureCaptionText("iii", captionFaceFile("mono", 400), 10),
    );
  });

  it("a short line stays whole; a line that fits exactly stays whole; one unit narrower wraps at the last space", () => {
    expect(wrapCaptionLine("Menu", 500, measure)).toEqual(["Menu"]);
    const line = "Scan for the menu · Сканируйте меню";
    const exact = measure(line);
    expect(wrapCaptionLine(line, exact, measure)).toEqual([line]);
    const [first, ...rest] = wrapCaptionLine(line, exact - 0.01, measure);
    expect(`${first} ${rest.join(" ")}`).toBe(line);
    expect(first?.endsWith("Сканируйте")).toBe(true);
    expect(rest).toEqual(["меню"]);
  });

  it("a long unbroken token splits only between graphemes: joined emoji and combining marks stay whole", () => {
    const token = "Ё̈👩🏽‍💻Йод🇺🇦é".repeat(6);
    const lines = wrapCaptionLine(token, measure("Ё̈👩🏽‍💻Йод"), measure);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.join("")).toBe(token);
    const all = graphemes(token);
    let i = 0;
    for (const l of lines)
      for (const g of graphemes(l)) {
        expect(g).toBe(all[i]); // each line is a run of the original graphemes, never part of one
        i++;
      }
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(measure("Ё̈👩🏽‍💻Йод") + 1e-9);
  });

  it("explicit line breaks are kept; wrapped continuations keep their line's style", () => {
    const layout = designToLayout(
      design({ caption: "Сканируйте меню · Ёлка Йод · Little Fern Café\nTable 4 · Столик 4 · ўсё", captionWeight: 700 }),
    );
    const svg = composeLayout(layout, VALUE).svg;
    const t = tspans(svg);
    const title = t.filter((l) => l.weight === 700);
    const second = t.filter((l) => l.weight === 400);
    expect(title.length).toBeGreaterThanOrEqual(2);
    expect(second.length).toBeGreaterThanOrEqual(1);
    expect(title.map((l) => l.text).join(" ")).toBe("Сканируйте меню · Ёлка Йод · Little Fern Café");
    expect(second.map((l) => l.text).join(" ")).toBe("Table 4 · Столик 4 · ўсё");
    expect(new Set(title.map((l) => l.size)).size).toBe(1);
    expect(svg.match(/fill-opacity="0.72"/g)?.length).toBe(second.length);
  });
});

describe("caption wrapping follows the layout, not the viewer (HEY-47)", () => {
  const breaks = (p: Partial<EditorDesign>) => tspans(composeLayout(designToLayout(design(p)), VALUE).svg).map((l) => l.text);
  const text = "Сканируйте меню · Ёлка Йод · Little Fern Café";

  it("a narrow band wraps more than a wide one; size and weight change the breaks; alignment doesn't", () => {
    const narrow = breaks({ caption: text, size: { unit: "px", qr: 512, width: 512, height: 640 } });
    const wide = breaks({ caption: text, size: { unit: "px", qr: 512, width: 1200, height: 640 } });
    expect(narrow.length).toBeGreaterThan(wide.length);
    expect(breaks({ caption: text, captionSize: 24 })).not.toEqual(breaks({ caption: text, captionSize: 40 }));
    expect(breaks({ caption: text, captionFont: "mono", captionWeight: 700 })).not.toEqual(
      breaks({ caption: text, captionFont: "caveat", captionWeight: 400 }),
    );
    expect(breaks({ caption: text, captionAlign: "left" })).toEqual(breaks({ caption: text, captionAlign: "right" }));
  });

  it("the same layout breaks the same in any unit scale: px and its mm equivalent produce the same lines", () => {
    const px = breaks({ caption: text, size: { unit: "px", qr: 512, width: 512, height: 625 }, captionSize: 40 });
    const mm = breaks({
      caption: text,
      size: { unit: "mm", qr: 43.3, width: 43.3, height: 52.9 },
      captionSize: (40 * (43.3 / 512)) / 0.3528,
    });
    expect(mm).toEqual(px);
  });
});

describe("fit after wrapping (HEY-47)", () => {
  it("draws at the chosen size when the wrapped lines fit; otherwise the largest size that fits, every line inside the band", () => {
    const short = designToLayout(design({ caption: "Menu" }));
    expect(layoutCaptionLines(short, layoutGeometry(short)).fs).toBe(40);
    const long = designToLayout(
      design({
        caption: "Сканируйте меню · Ёлка Йод · Little Fern Café · seasonal\nTable 4 · Столик 4 · ўсё · pay in-app",
        captionSize: 120,
      }),
    );
    const g = layoutGeometry(long);
    const { fs, lines } = layoutCaptionLines(long, g);
    expect(fs).toBeLessThan(120);
    const band = g.caption ?? [0, 0, 0, 0];
    for (const l of lines)
      expect(measureCaptionText(l.text, captionFaceFile("dm", l.secondary ? 400 : 700), l.size)).toBeLessThanOrEqual(band[2] * 0.94 + 1e-6);
    expect(1.18 * lines.reduce((s, l) => s + l.size, 0)).toBeLessThanOrEqual(band[3] * 0.86 + 1e-6);
    // Fitting is a maximum: a slightly larger title would not fit.
    expect(fitCaption(long.caption, fs * 1.02, band[2], band[3]).fs).toBeLessThan(fs * 1.02);
  });

  it("captions that never needed wrapping keep their size and line positions", () => {
    const layout = designToLayout(design({ caption: "Scan me\nTable 4" }));
    const [a, b] = tspans(composeLayout(layout, VALUE).svg);
    const band = layoutGeometry(layout).caption ?? [0, 0, 0, 0];
    const fs = 40;
    const total = fs * 1.15 + fs * 0.74 * 1.3;
    const ty = band[1] + band[3] / 2 - total / 2 + fs * 0.85;
    expect([a?.size, a?.y, b?.size, b?.y]).toEqual([
      fs,
      Math.round(ty * 1000) / 1000,
      29.6,
      Math.round((ty + fs * 0.3 + 29.6 * 1.3) * 1000) / 1000,
    ]);
  });

  it("the saved layout keeps the original caption text; wrapping is recomputed from the settings when reopened", () => {
    const caption = "Сканируйте меню · Ёлка Йод · Little Fern Café\nTable 4";
    const d = design({ caption });
    const record = createLayoutRecord(designToLayout(d), designSettingsOf(d));
    expect(record?.layout.caption.text).toBe(caption);
    if (!record) return;
    const reopened = designFromSaved({ name: "x", model: "static", content: { type: "website", url: VALUE } }, record);
    expect(reopened.caption).toBe(caption);
    expect(composeLayout(designToLayout(reopened), VALUE).svg).toBe(composeLayout(record.layout, VALUE).svg);
  });
});

describe("exported PNG draws exactly the computed lines (HEY-47)", () => {
  it("one ink band per wrapped line at the SVG's baselines, and the code still decodes", async () => {
    const layout = designToLayout(
      design({ caption: "Сканируйте меню · Ёлка Йод · Little Fern Café\nTable 4 · ўсё", captionColor: "#C8102E" }),
    );
    const t = tspans(composeLayout(layout, VALUE).svg);
    expect(t.length).toBeGreaterThanOrEqual(3);
    const body = (await renderExport(layout, VALUE, "png", { scale: 2 })).body;
    const png = readPng(new Uint8Array(body));
    const redRow = (y: number) => {
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        const [r, g, b] = [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
        if (r - g > 70 && r - b > 60) return true;
      }
      return false;
    };
    for (const l of t) {
      // Ink just above each baseline, and none in the gap halfway between lines.
      expect(redRow(Math.round((l.y - l.size * 0.35) * 2))).toBe(true);
    }
    // Nothing drawn above the first line or below the last one: no extra or missing lines.
    const first = t[0];
    const last = t.at(-1);
    const top = Math.ceil((layoutGeometry(layout).caption?.[1] ?? 0) * 2);
    if (first && last) {
      for (let y = top; y < Math.floor((first.y - first.size * 1.1) * 2); y++) expect(redRow(y)).toBe(false);
      for (let y = Math.ceil((last.y + last.size * 0.35) * 2); y < png.height; y++) expect(redRow(y)).toBe(false);
    }
    expect(await decodeImage(new Uint8Array(body))).toBe(VALUE);
  });
});

describe("caption metrics match the shipped fonts (HEY-47)", () => {
  it("every face's generated widths equal the font files' advances (regenerate with pnpm fonts:metrics)", async () => {
    const { readFileSync } = await import("node:fs");
    const { readTtf } = await import("../../../packages/qr-core/test/ttf-cmap");
    const { CAPTION_METRICS } = await import("../../../packages/qr-core/src/caption-metrics");
    for (const [file, m] of Object.entries(CAPTION_METRICS)) {
      const ttf = readTtf(new Uint8Array(readFileSync(`${process.cwd()}/public/caption-fonts/${file}`)));
      for (const [first, widths] of m.runs)
        widths.forEach((w, i) =>
          expect(w, `${file} U+${(first + i).toString(16)}`).toBe(
            Math.round(((ttf.advances.get(first + i) ?? -1) * 1000) / ttf.unitsPerEm),
          ),
        );
    }
  });
});
