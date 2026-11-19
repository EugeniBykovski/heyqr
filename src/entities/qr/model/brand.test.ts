import { composeLayout, contrastRatio, MIN_CONTRAST } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { brandColorPatch, brandLookPatch, brandNameFromFile, brandRoles, extractPalette } from "./brand";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "./design";
import { createLayoutRecord, designSettingsOf } from "./design-schema";
import { designFromSaved } from "./saved-design";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/* Design 2.4–2.9 Branded design: palette, roles and looks. */
const VALUE = "https://littlefern.coffee/menu";
const LOGO = `data:image/png;base64,${rasterizeSvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="56" fill="#1F4D3A"/><path d="M60 20c-14 14-14 34 0 48c14-14 14-34 0-48z" fill="#C8643B"/></svg>`,
  { width: 120 },
).toString("base64")}`;

/** RGBA pixels: `n` of each colour (and some transparent ones that must be ignored). */
function pixels(colours: [string, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [hex, n] of colours)
    for (let i = 0; i < n; i++) out.push(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255);
  for (let i = 0; i < 50; i++) out.push(255, 0, 255, 0);
  return new Uint8ClampedArray(out);
}

describe("palette from an image", () => {
  it("finds the main colours, most used first, ignoring transparent pixels and merging near-duplicates", () => {
    const palette = extractPalette(
      pixels([
        ["#F7F1E6", 400],
        ["#1F4D3A", 300],
        ["#1F4E3B", 50],
        ["#C8643B", 120],
        ["#8DB596", 60],
      ]),
    );
    expect(palette[0]).toBe("#F7F1E6");
    expect(palette).toContain("#C8643B");
    expect(palette.filter((c) => c.startsWith("#1F4"))).toHaveLength(1);
    expect(palette.some((c) => c === "#FF00FF")).toBe(false);
  });
  it("an image with no opaque pixels has no palette", () => {
    expect(extractPalette(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 10]))).toEqual([]);
  });
});

describe("roles", () => {
  it("background = lightest, code = a dark colour that passes the scan contrast, accent = the most saturated usable one", () => {
    const r = brandRoles(["#1F4D3A", "#F7F1E6", "#C8643B", "#8DB596", "#3B2A20"]);
    expect(r.bg).toBe("#F7F1E6");
    expect(r.primary).toBe("#1F4D3A");
    expect(r.accent).toBe("#C8643B");
    expect(contrastRatio(r.primary, r.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST.modules);
  });
  it("falls back to white and ink when the image has no light or no dark colour, so the result always scans", () => {
    expect(brandRoles(["#FFD400", "#FF8A00"])).toMatchObject({ bg: "#FFFFFF", primary: "#0D0D12" });
    expect(brandRoles([])).toEqual({ primary: "#0D0D12", bg: "#FFFFFF", accent: "#0D0D12" });
  });
  it("brand file names read as names", () => {
    expect(brandNameFromFile("little-fern_coffee.svg")).toBe("Little Fern Coffee");
  });
});

describe("three looks of the same code", () => {
  const branded: EditorDesign = {
    ...DEFAULT_DESIGN,
    content: { type: "website", url: VALUE },
    designMode: "branded",
    preset: "caption",
    caption: "Scan for the menu",
    logo: { kind: "image", href: LOGO },
    brand: { palette: ["#1F4D3A", "#F7F1E6", "#C8643B", "#8DB596"], name: "little-fern-coffee.svg" },
    ...brandColorPatch({ primary: "#1F4D3A", bg: "#F7F1E6", accent: "#C8643B" }),
  };
  for (const look of ["center", "card", "art"] as const)
    it(`${look}: one patch, same payload and colours; canvas, save/reopen, SVG and PNG decode`, async () => {
      const d = { ...branded, ...brandLookPatch(branded, look) };
      expect([d.fg, d.bg, d.eyeIn]).toEqual(["#1F4D3A", "#F7F1E6", "#C8643B"]);
      const layout = designToLayout(d);
      if (look === "card") expect([layout.preset, layout.topLogoHref, layout.brandName]).toEqual(["vertical", LOGO, "Little Fern Coffee"]);
      if (look === "art") expect(layout.style.art).toEqual({ tint: "#8DB596", tint2: "#C8643B", image: LOGO });
      if (look === "center") expect(layout.style.logo?.href).toBe(LOGO);
      const { svg, scan } = composeLayout(layout, VALUE);
      expect(scan.ok).toBe(true);
      const record = createLayoutRecord(layout, designSettingsOf(d));
      if (!record) throw new Error("refused");
      const reopened = designFromSaved({ name: "Menu", model: "static", content: d.content }, record);
      expect(composeLayout(designToLayout(reopened), VALUE).svg).toBe(svg);
      expect(await decodeImage(rasterizeSvg((await renderExport(layout, VALUE, "svg", {})).body.toString(), { width: 900 }))).toBe(VALUE);
      expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body))).toBe(VALUE);
    }, 30_000);

  it("Artwork picks a tint that keeps the code scannable (a dark leftover colour is not used)", () => {
    const withDark = { ...branded, brand: { palette: ["#1F4D3A", "#F7F1E6", "#557665", "#C8643B", "#8DB596"] } };
    const d = { ...withDark, ...brandLookPatch(withDark, "art") };
    expect(d.art?.tint).toBe("#8DB596");
    expect(composeLayout(designToLayout(d), VALUE).scan.ok).toBe(true);
  });

  it("anti-aliased edge colours are left out of the palette", () => {
    const palette = extractPalette(
      pixels([
        ["#1F4D3A", 500],
        ["#F7F1E6", 400],
        ["#8BA095", 3],
        ["#557665", 4],
      ]),
    );
    expect(palette).toEqual(["#1F4D3A", "#F7F1E6"]);
  });

  it("Artwork's scan check reads the tinted background: a code colour fine on cream fails on a dark tint", () => {
    const art = { ...branded, ...brandLookPatch(branded, "art"), fg: "#6B7F72", eye: "#6B7F72" };
    expect(contrastRatio("#6B7F72", "#F7F1E6")).toBeGreaterThan(MIN_CONTRAST.modules);
    expect(composeLayout(designToLayout({ ...art, art: undefined }), VALUE).scan.ok).toBe(true);
    expect(
      composeLayout(designToLayout({ ...art, art: { tint: "#3B2A20", tint2: "#C8643B" } }), VALUE).scan.issues.map((i) => i.code),
    ).toContain("contrast");
  });
});
