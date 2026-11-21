import { composeLayout } from "@heyqr/qr-core";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import { causePatch, confirmCauses, findScanningLogoSize, smallerLogoSizes } from "./scan-guidance";

/*
 * HEY-68: failure causes and "Reduce logo size" are confirmed by decoding test renders with ZXing (the same reader the
 * browser check runs), never by a rule alone.
 */
// Real decodes (up to 36 for one search): generous timeouts so a loaded CI machine doesn't fail them.
vi.setConfig({ testTimeout: 120_000 });
const VALUE = "https://anareyes.studio/portfolio";
const zxing = (svg: string) => decodeSvg(svg, 720);
const scans = async (d: EditorDesign) => (await zxing(composeLayout(designToLayout(d), VALUE).svg)) === VALUE;
const card = (patch: Partial<EditorDesign>): EditorDesign => ({ ...DEFAULT_DESIGN, content: { type: "website", url: VALUE }, ...patch });

const bigLogo = card({ logo: { kind: "icon", icon: "coffee" }, logoSize: 0.46 });
const lightCorners = card({ eye: "#F5F5F5", eyeIn: "#F5F5F5" });

describe("scan failure causes (HEY-68)", () => {
  it("names the logo when a render with only the logo removed scans", async () => {
    expect(await scans(bigLogo)).toBe(false);
    expect(await confirmCauses(bigLogo, VALUE, zxing)).toEqual(["logo"]);
  });

  it("names the corner markers when a render with only them darkened scans", async () => {
    expect(await scans(lightCorners)).toBe(false);
    expect(await confirmCauses(lightCorners, VALUE, zxing)).toEqual(["eyes"]);
  });

  it("names nothing (general guidance) when no single change makes it scan", async () => {
    const both = { ...bigLogo, eye: "#F5F5F5", eyeIn: "#F5F5F5" };
    expect(await scans(both)).toBe(false);
    expect(await confirmCauses(both, VALUE, zxing)).toEqual([]);
  });

  it("names the text in the code when moving only the text out of the code scans", async () => {
    const text = card({ preset: "caption", caption: "Little Fern Co", captionPosition: "inside" });
    const original = composeLayout(designToLayout(text), VALUE).svg;
    // The renderer keeps text in the code recoverable, so the failing reader is simulated: it can't read the original.
    const decoder = vi.fn(async (svg: string) => (svg === original ? null : VALUE));
    expect(await confirmCauses(text, VALUE, decoder)).toEqual(["text"]);
    expect(causePatch("text", text)).toEqual({ captionPosition: "below" });
  });

  it("each test render changes one setting only", () => {
    expect(causePatch("logo", bigLogo)).toEqual({ logo: { kind: "none" } });
    expect(causePatch("eyes", lightCorners)).toEqual({ eye: lightCorners.fg, eyeIn: lightCorners.fg });
    expect(causePatch("contrast", card({ fg: "#B4B4B4" }))).toEqual({ fg: "#0D0D12" });
    expect(causePatch("contrast", card({ fg: "#333333" }))).toBeNull(); // already strong: not a contrast problem
    expect(causePatch("invert", card({ fg: "#FFFFFF", bg: "#111111" }))).toEqual({ fg: "#111111", bg: "#FFFFFF" });
  });
});

describe("Reduce logo size (HEY-68)", () => {
  it("applies the largest smaller supported size that decodes to the payload", async () => {
    const found = await findScanningLogoSize(bigLogo, VALUE, zxing, () => true);
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.size).toBeLessThan(bigLogo.logoSize);
    expect(await scans({ ...bigLogo, logoSize: found.size })).toBe(true);
    // Every larger candidate it tried first did not scan.
    for (const s of smallerLogoSizes(bigLogo.logoSize).filter((s) => s > found.size))
      expect(await scans({ ...bigLogo, logoSize: s })).toBe(false);
  });

  it("finds nothing when no smaller size scans (another setting breaks it) and tries each size once", async () => {
    const both = { ...bigLogo, eye: "#F5F5F5", eyeIn: "#F5F5F5" };
    const decoder = vi.fn(zxing);
    const found = await findScanningLogoSize(both, VALUE, decoder, () => true);
    expect(found).toEqual({ kind: "none", tried: smallerLogoSizes(0.46).length });
    expect(decoder).toHaveBeenCalledTimes(smallerLogoSizes(0.46).length);
    expect(smallerLogoSizes(0.46)).toEqual(expect.arrayContaining([0.45, 0.1]));
  });

  it("stops without a result when the artwork changed during the search", async () => {
    let current = true;
    const decoder = vi.fn(async () => {
      current = false; // an edit, Undo / Redo or layout switch while the first candidate decodes
      return VALUE;
    });
    expect(await findScanningLogoSize(bigLogo, VALUE, decoder, () => current)).toEqual({ kind: "stale" });
    expect(decoder).toHaveBeenCalledTimes(1);
  });
});
