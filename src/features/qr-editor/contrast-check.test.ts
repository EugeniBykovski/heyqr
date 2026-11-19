import { composeLayout, contrastRatio, MIN_CONTRAST, renderQrSvg, type QrColors } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
// The shared export function behind GET /api/export/[layoutId] (after auth and payment checks).
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-38: the scan check's colour rule, evaluated on the effective colours the renderer gets (after corner colours
 * inherit the module colour). Modules: darker than the background and ≥ 3:1; corner frames ≥ 3:1 and centres ≥ 2.5:1,
 * also darker than the background. The rule is a check, not a decode: verdicts are compared with ZXing where it matters.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
const check = (d: Partial<EditorDesign>) => {
  const layout = designToLayout({ ...DEFAULT_DESIGN, ...d });
  const { scan } = composeLayout(layout, VALUE);
  return { ok: scan.ok, issues: scan.issues.map((i) => i.code).sort(), colors: layout.colors };
};
const grey = (v: number) => `#${v.toString(16).padStart(2, "0").repeat(3).toUpperCase()}`;
/** The two greys on either side of a contrast threshold against white (independent of the renderer's rule). */
const aroundThreshold = (ratio: number) => {
  let below = "";
  let above = "";
  for (let v = 0; v <= 255; v++) {
    const c = grey(v);
    if (contrastRatio(c, "#FFFFFF") >= ratio) above = c;
    else if (!below) below = c;
  }
  return { above, below };
};

describe("contrast rule (HEY-38)", () => {
  it("documents the thresholds the product already used", () => {
    expect(MIN_CONTRAST).toEqual({ modules: 3, eyeFrame: 3, eyeCenter: 2.5 });
  });

  it("default palette passes; corners inherit the module colour", () => {
    const r = check({});
    expect(r).toMatchObject({ ok: true, issues: [] });
    expect([r.colors.eye, r.colors.eyeIn]).toEqual([DEFAULT_DESIGN.fg, DEFAULT_DESIGN.fg]);
    expect(contrastRatio("#0D0D12", "#FFFFFF")).toBeGreaterThan(19);
  });

  it("a high-contrast custom palette with independent corners passes", () => {
    expect(check({ fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" })).toMatchObject({ ok: true, issues: [] });
  });

  it("identical colours fail for the modules and, inherited, for the corners", () => {
    expect(check({ fg: "#1F4D3A", bg: "#1F4D3A" })).toMatchObject({ ok: false, issues: ["contrast", "eyes"] });
  });

  it("a low-contrast pair fails (#777777 on #888888)", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(1.3);
    expect(check({ fg: "#777777", bg: "#888888" })).toMatchObject({ ok: false, issues: ["contrast", "eyes"] });
  });

  it("module pair around 3:1: just below fails, at or above passes", () => {
    const { above, below } = aroundThreshold(3);
    expect(contrastRatio(below, "#FFFFFF")).toBeLessThan(3);
    expect(contrastRatio(above, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(check({ fg: below, eye: "#000000", eyeIn: "#000000" }).issues).toEqual(["contrast"]);
    expect(check({ fg: above, eye: "#000000", eyeIn: "#000000" }).ok).toBe(true);
  });

  it("finder frame around 3:1 and centre around 2.5:1, with a passing module pair", () => {
    const frame = aroundThreshold(3);
    const centre = aroundThreshold(2.5);
    expect(check({ eye: frame.below }).issues).toEqual(["eyes"]);
    expect(check({ eye: frame.above }).ok).toBe(true);
    expect(check({ eyeIn: centre.below }).issues).toEqual(["eyes"]);
    expect(check({ eyeIn: centre.above }).ok).toBe(true);
  });

  it("a passing module pair can't hide light finders: inverted finders fail the check, and ZXing confirms they don't decode", async () => {
    // Modules 5.3:1 and finders 3.95:1, but the finders are lighter than the mid-grey background.
    const colors: QrColors = { fg: "#000000", eye: "#FFFFFF", eyeIn: "#FFFFFF", bg: "#808080" };
    expect(contrastRatio(colors.eye, colors.bg)).toBeGreaterThan(3);
    expect(check({ fg: colors.fg, eye: colors.eye, eyeIn: colors.eyeIn, bg: colors.bg })).toMatchObject({ ok: false, issues: ["eyes"] });
    expect(check({ fg: "#000000", eye: "#FFFFFF", bg: "#808080" }).issues).toEqual(["eyes"]); // the frame alone
    const svg = renderQrSvg(VALUE, { pattern: "square", eyeFrame: "square", eyeBall: "square", colors }, 600);
    expect(await decodeSvg(svg, 900)).toBeNull();
  });

  it("light modules on a dark background are flagged as inverted", () => {
    expect(check({ fg: "#FFFFFF", bg: "#0D0D12" })).toMatchObject({ ok: false, issues: ["eyes", "invert"] });
  });

  for (const [name, palette] of [
    ["default palette", {}],
    ["custom passing palette", { fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" }],
  ] as const)
    it(`${name}: passes the check and the exported SVG and PNG decode to the exact payload`, async () => {
      const layout = designToLayout({ ...DEFAULT_DESIGN, ...palette });
      const svg = await renderExport(layout, VALUE, "svg", {});
      const png = await renderExport(layout, VALUE, "png", {});
      expect([svg.scan.ok, png.scan.ok]).toEqual([true, true]);
      expect(await decodeImage(new Uint8Array(png.body)), "exported PNG").toBe(VALUE);
      expect(await decodeImage(rasterizeSvg(svg.body.toString(), { width: 800 })), "exported SVG rasterized at 800 px").toBe(VALUE);
    });
});
