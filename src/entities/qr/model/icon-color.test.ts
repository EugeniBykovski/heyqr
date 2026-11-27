import { decodeSvg } from "@heyqr/qr-core/verify";
import { composeLayout } from "@heyqr/qr-core";
import { describe, expect, it } from "vitest";
import { CENTER_ICONS, DEFAULT_DESIGN, designToLayout, patchDesign, type EditorDesign } from "./design";
import { DESIGN_SCHEMA_VERSION, designSettingsOf, type LayoutRecordDesign } from "./design-schema";
import { designFromSaved } from "./saved-design";

/*
 * HEY-195 / design 1.11: the 38 library icons are vector and take the corner-center color. A plate icon used to be drawn
 * in the module color; layouts saved that way keep their look when reopened, until the icon or the corner-center color
 * changes.
 */
const website = { type: "website" as const, url: "https://littlefern.cafe/menu" };
const base: EditorDesign = { ...DEFAULT_DESIGN, content: website, fg: "#1F4D3A", eyeIn: "#C8643B", logo: { kind: "icon", icon: "coffee" } };
const strokeOf = (svg: string) => /stroke="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1]?.toLowerCase();

describe("library icons take the corner-center color (HEY-195)", () => {
  it("has 38 searchable vector icons", () => {
    expect(Object.keys(CENTER_ICONS)).toHaveLength(38);
    for (const d of Object.values(CENTER_ICONS)) expect(d).toMatch(/^M/);
  });

  it("a plate icon is drawn in the corner-center color, vector, and the code still decodes", async () => {
    const layout = designToLayout(base);
    expect(layout.style.logo?.iconColor).toBe("#C8643B");
    const svg = composeLayout(layout, "https://littlefern.cafe/menu").svg;
    expect(strokeOf(svg)).toBe("#c8643b");
    expect(svg).toContain(`<path d="${CENTER_ICONS.coffee}"`);
    expect(await decodeSvg(svg)).toBe("https://littlefern.cafe/menu");
  });

  it("without its own corner-center color, the icon follows the modules (as before)", () => {
    expect(designToLayout({ ...base, eyeIn: undefined }).style.logo?.iconColor).toBe("#1F4D3A");
  });

  it("a color tile is the corner-center color with the icon in the background color", () => {
    const svg = composeLayout(designToLayout({ ...base, logoTile: true }), "https://littlefern.cafe/menu").svg;
    expect(svg).toContain('fill="#C8643B"');
    expect(strokeOf(svg)).toBe(base.bg.toLowerCase());
  });

  it("a layout saved before keeps its module-colored icon when reopened, with and without editor settings", () => {
    const legacyLayout = designToLayout(base);
    legacyLayout.style.logo = { ...legacyLayout.style.logo, size: base.logoSize, plate: "circle", iconColor: "#1F4D3A" };
    const qr = { name: "Menu", model: "static" as const, content: website };
    const records: LayoutRecordDesign[] = [
      { schemaVersion: DESIGN_SCHEMA_VERSION, layout: legacyLayout },
      { schemaVersion: DESIGN_SCHEMA_VERSION, layout: legacyLayout, editor: designSettingsOf(base) },
    ];
    for (const record of records) {
      const reopened = designFromSaved(qr, record);
      expect(reopened.iconColor).toBe("#1F4D3A");
      expect(JSON.stringify(designToLayout(reopened).style.logo)).toBe(JSON.stringify(legacyLayout.style.logo));
    }
  });

  it("choosing or removing an icon, or changing the corner-center color, drops the kept color; other edits keep it", () => {
    const kept: EditorDesign = { ...base, iconColor: "#1F4D3A" };
    expect(patchDesign(kept, { logoSize: 0.2 }).iconColor).toBe("#1F4D3A");
    expect(patchDesign(kept, { logo: { kind: "icon", icon: "wifi" } }).iconColor).toBeUndefined();
    expect(patchDesign(kept, { logo: { kind: "none" } }).iconColor).toBeUndefined();
    expect(patchDesign(kept, { eyeIn: "#1F4D3A" }).iconColor).toBeUndefined();
    expect(designToLayout(patchDesign(kept, { eyeIn: "#336699" })).style.logo?.iconColor).toBe("#336699");
  });

  it("changing the corner-center color reruns the scan check: too light is flagged, a dark one passes again", () => {
    const url = "https://littlefern.cafe/menu";
    const light = composeLayout(designToLayout({ ...base, eyeIn: "#F4F1EA" }), url).scan;
    const dark = composeLayout(designToLayout({ ...base, eyeIn: "#1F4D3A" }), url).scan;
    expect(light.ok).toBe(false);
    expect(light.issues.length).toBeGreaterThan(0);
    expect(dark.ok).toBe(true);
  });
});
