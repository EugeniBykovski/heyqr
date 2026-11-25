import { composeLayout, encodePayload } from "@heyqr/qr-core";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, FRAME_STYLES, MODULE_SHAPES } from "./design";
import { directContent, emptyContent, isContentComplete } from "./content";

const url = "https://anareyes.studio/portfolio";

describe("designToLayout", () => {
  it("default editor design scans", async () => {
    const out = composeLayout(designToLayout(DEFAULT_DESIGN), url);
    expect(out.scan.ok).toBe(true);
    expect(await decodeSvg(out.svg)).toBe(url);
  });

  it("every module shape with a center icon still scans", async () => {
    for (const pattern of MODULE_SHAPES) {
      const out = composeLayout(designToLayout({ ...DEFAULT_DESIGN, pattern, logo: { kind: "icon", icon: "coffee" } }), url);
      expect(await decodeSvg(out.svg), pattern).toBe(url);
    }
    // Several ZXing decodes in one test (about 2 s on a 12-core laptop): room for a busy CI runner, not the 5 s default.
  }, 30_000);

  it("every frame keeps the caption and scans", async () => {
    for (const frameStyle of FRAME_STYLES) {
      const out = composeLayout(designToLayout({ ...DEFAULT_DESIGN, preset: "frame", frameStyle, caption: "Scan me" }), url);
      expect(out.svg).toContain("Scan me");
      expect(await decodeSvg(out.svg, 900), frameStyle).toBe(url);
    }
    // Several ZXing decodes in one test (about 2 s on a 12-core laptop): room for a busy CI runner, not the 5 s default.
  }, 30_000);
});

describe("content", () => {
  it("knows when required fields are filled", () => {
    expect(isContentComplete(emptyContent("wifi"))).toBe(false);
    expect(isContentComplete({ type: "wifi", ssid: "Fern Guest", security: "WPA", password: "x" })).toBe(true);
    expect(isContentComplete({ type: "contact" })).toBe(true);
  });

  it("empty content of every type encodes without throwing", () => {
    for (const type of ["website", "text", "wifi", "contact", "email", "phone", "sms", "location", "event"] as const) {
      expect(() => encodePayload(directContent(emptyContent(type)))).not.toThrow();
    }
  });
});
