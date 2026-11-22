import { CENTER_LOGO_SIZE, composeLayout } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import {
  createLayoutRecord,
  DEFAULT_DESIGN,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  type EditorDesign,
  type EditorPreset,
} from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-56: one QR with an uploaded non-square raster logo (transparent background) on a circle backing, carried through
 * QR only, QR + caption, Vertical card and Horizontal card as the editor builds them (designToLayout), with a long
 * mixed-script caption. Every export (PNG, and the standalone SVG rasterized offline) decodes to the exact payload, shows
 * the logo on its backing with the transparent parts showing the backing, and leaves the quiet zone clear. Near the
 * HEY-52 limit the scan check flags the design and its suggested size exports and decodes in every layout.
 */
const VALUE = "https://anareyes.studio/portfolio";
const BG = "#F7F1E6";
const FG = "#1F2A44";
const RED = "#C8102E";
// 480 × 200, transparent outside the pill, with a white mark and a translucent dot inside it.
const PILL = `data:image/png;base64,${rasterizeSvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200" viewBox="0 0 480 200"><rect x="10" y="40" width="460" height="120" rx="60" fill="${RED}"/><circle cx="100" cy="100" r="44" fill="#FFFFFF"/><circle cx="100" cy="100" r="30" fill="${RED}" fill-opacity="0.55"/><rect x="170" y="78" width="250" height="44" rx="22" fill="#FFFFFF"/></svg>`,
  { width: 480 },
).toString("base64")}`;
const LONG = "Сканируйте меню у стойки · Ёлка Йод Ії ўсё · Little Fern Café\nСтолик 4 · Table 4";
const PRESETS: readonly EditorPreset[] = ["qr", "caption", "vertical", "horizontal"];
const design = (preset: EditorPreset, logoSize: number): EditorDesign => ({
  ...DEFAULT_DESIGN,
  fg: FG,
  bg: BG,
  logo: { kind: "image", href: PILL },
  logoPlate: "circle",
  logoSize,
  caption: LONG,
  preset,
  size: { unit: "px", qr: 512, width: 512, height: 512 },
});

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (p: number[], c: number[], t: number) => p.reduce((s, v, i) => s + Math.abs(v - (c[i] ?? 0)), 0) <= t;
const num = (tag: string, a: string) => Number(tag.match(new RegExp(` ${a}="([\\d.]+)"`))?.[1]);

/** What the exported pixels show around the code: quiet zone, logo, backing. Positions come from the exported SVG. */
function inspect(img: { width: number; height: number; data: Uint8Array }, svg: string) {
  const k = img.width / Number(svg.match(/^<svg [^>]*viewBox="0 0 ([\d.]+) /)?.[1]);
  const codeTag = svg.match(/<svg x="[^>]*>/)?.[0] ?? "";
  const modules = Number(codeTag.match(/viewBox="0 0 (\d+)/)?.[1]);
  const m = (num(codeTag, "width") / modules) * k;
  const [x0, y0, side] = [num(codeTag, "x") * k, num(codeTag, "y") * k, num(codeTag, "width") * k];
  const imageTag = (svg.match(/<image [^>]*>/)?.[0] ?? "").replace(/href="[^"]*"/, "");
  const half = (num(imageTag, "width") / 2) * m;
  const cx = x0 + num(imageTag, "x") * m + half;
  const cy = y0 + num(imageTag, "y") * m + half;
  const px = (x: number, y: number) => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
  };
  const [bg, fg, red] = [rgb(BG), rgb(FG), rgb(RED)];
  let quietInk = 0;
  for (let y = Math.ceil(y0 + 1); y < y0 + side - 1; y++)
    for (let x = Math.ceil(x0 + 1); x < x0 + side - 1; x++) {
      const inside = x > x0 + 4 * m - 1 && x < x0 + side - 4 * m + 1 && y > y0 + 4 * m - 1 && y < y0 + side - 4 * m + 1;
      if (!inside && !near(px(x, y), bg, 24)) quietInk++;
    }
  // The circle backing: the image's box is inscribed in it, and it reaches 0.56 module past the logo box (HEY-52).
  const radius = half * Math.SQRT2 + 0.56 * m;
  let logo = 0;
  let inkUnderBacking = 0;
  let ring = 0;
  let ringBg = 0;
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++)
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      if (Math.hypot(x - cx, y - cy) > radius - 1.5) continue;
      const p = px(x, y);
      if (near(p, red, 40)) logo++;
      if (near(p, fg, 40)) inkUnderBacking++;
      if (Math.abs(x - cx) > half + 1 || Math.abs(y - cy) > half + 1) {
        ring++;
        if (near(p, bg, 24)) ringBg++;
      }
    }
  // Above the 480 × 200 image inside its square box the logo is transparent: the backing shows there.
  let strip = 0;
  let stripBg = 0;
  for (let y = Math.ceil(cy - half + 1); y < cy - half * (200 / 480) - 1; y++)
    for (let x = Math.ceil(cx - half * 0.8); x < cx + half * 0.8; x++) {
      strip++;
      if (near(px(x, y), bg, 24)) stripBg++;
    }
  return { quietInk, logo, inkUnderBacking, ring, ringBg, strip, stripBg };
}

async function exportAndCheck(preset: EditorPreset, logoSize: number) {
  const layout = designToLayout(design(preset, logoSize));
  const svg = (await renderExport(layout, VALUE, "svg", {})).body.toString();
  const pngFile = (await renderExport(layout, VALUE, "png", { scale: 2 })).body;
  const png = readPng(new Uint8Array(pngFile));
  const offline = rasterizeSvg(svg, { width: png.width }); // the standalone file: no network, no page fonts
  expect([...svg.matchAll(/(?:href="|url\(["']?)https?:/g)]).toHaveLength(0);
  expect(svg).toMatch(/<image href="data:image\/png;base64,[^"]+"[^>]*preserveAspectRatio="xMidYMid meet"/);
  expect(await decodeImage(new Uint8Array(pngFile))).toBe(VALUE);
  expect(await decodeImage(offline)).toBe(VALUE);
  for (const [name, r] of [
    ["PNG", inspect(png, svg)],
    ["SVG", inspect(readPng(offline), svg)],
  ] as const) {
    expect(r.quietInk, `${preset} ${name}: quiet zone`).toBe(0);
    expect(r.logo, `${preset} ${name}: logo visible`).toBeGreaterThan(1000);
    expect(r.inkUnderBacking, `${preset} ${name}: no code ink under the backing`).toBe(0);
    expect([r.ring > 1000, r.ringBg], `${preset} ${name}: backing visible round the logo`).toEqual([true, r.ring]);
    expect([r.strip > 500, r.stripBg], `${preset} ${name}: transparent logo shows the backing`).toEqual([true, r.strip]);
  }
  return layout;
}

describe("one QR with an uploaded logo in the four layouts (HEY-56)", () => {
  it("switching layouts keeps the logo, backing, size, caption and colours, also through save and reopen", () => {
    let d = design("qr", 0.3);
    for (const preset of [...PRESETS, "qr"] as const) {
      d = { ...d, preset };
      const { style, colors } = designToLayout(d);
      expect([style.logo?.href, style.logo?.plate, style.logo?.size, colors.fg, colors.bg]).toEqual([PILL, "circle", 0.3, FG, BG]);
      const record = createLayoutRecord(designToLayout(d), designSettingsOf(d));
      if (!record) throw new Error("refused");
      const reopened = designFromSaved({ name: "Portfolio", model: "static", content: { type: "website", url: VALUE } }, record);
      expect([reopened.preset, reopened.logo, reopened.logoPlate, reopened.logoSize, reopened.caption, reopened.fg, reopened.bg]).toEqual([
        preset,
        { kind: "image", href: PILL },
        "circle",
        0.3,
        LONG,
        FG,
        BG,
      ]);
    }
  });

  for (const preset of PRESETS)
    it(`${preset} at 30 %: PNG and offline SVG decode exactly, logo and backing visible, quiet zone clear`, async () => {
      const layout = await exportAndCheck(preset, 0.3);
      expect(composeLayout(layout, VALUE).scan.ok).toBe(true);
    }, 60_000);

  for (const preset of PRESETS)
    it(`${preset} at the 46 % limit: flagged, and the suggested size exports and decodes`, async () => {
      const scan = composeLayout(designToLayout(design(preset, CENTER_LOGO_SIZE.max)), VALUE).scan;
      expect(scan.ok).toBe(false);
      expect(scan.issues.map((i) => i.code)).toContain("logo");
      expect(scan.maxLogoSize).toBeGreaterThanOrEqual(0.4);
      expect(scan.maxLogoSize).toBeLessThan(CENTER_LOGO_SIZE.max);
      const layout = await exportAndCheck(preset, scan.maxLogoSize);
      expect(composeLayout(layout, VALUE).scan.ok).toBe(true);
    }, 60_000);
});
