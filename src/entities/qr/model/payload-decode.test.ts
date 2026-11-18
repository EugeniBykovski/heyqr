import { readFileSync } from "node:fs";
import { composeLayout, encodePayload, type QrContent } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "./design";

/**
 * HEY-19: the app's own path (content → encodePayload → in-house matrix encoder → styled SVG → PNG) decodes,
 * with ZXing (independent of the encoder), to a payload written out by hand below, delimiters and line breaks included.
 */
const CASES: { name: string; content: QrContent; expected: string }[] = [
  { name: "Website", content: { type: "website", url: "littlefern.cafe/menu" }, expected: "https://littlefern.cafe/menu" },
  {
    name: "Website · pasted with query and fragment",
    content: { type: "website", url: "  https://littlefern.cafe/menu?table=4&lang=en#drinks  " },
    expected: "https://littlefern.cafe/menu?table=4&lang=en#drinks",
  },
  {
    name: "Website · explicit http",
    content: { type: "website", url: "http://legacy.example.com/path" },
    expected: "http://legacy.example.com/path",
  },
  {
    name: "Text",
    content: { type: "text", text: "Open daily 8:00–18:00\nKitchen closes at 17:30" },
    expected: "Open daily 8:00–18:00\nKitchen closes at 17:30",
  },
  {
    name: "Wi-Fi",
    content: { type: "wifi", ssid: "Test Guest Net", security: "WPA", password: "synthetic-pass-1" },
    expected: "WIFI:T:WPA;S:Test Guest Net;P:synthetic-pass-1;;",
  },
  {
    name: "Contact",
    content: { type: "contact", firstName: "Test", lastName: "Person", phone: "+1 555 0100", email: "test.person@example.com" },
    expected: "MECARD:N:Person,Test;TEL:+15550100;EMAIL:test.person@example.com;;",
  },
];

/** A styled design like the homepage hands to the editor: rounded modules, colour, caption frame. */
const layout = designToLayout({ ...DEFAULT_DESIGN, fg: "#1F5C45", pattern: "dot", preset: "caption", caption: "Scan me" });

describe("QR payload → matrix → decode (HEY-19)", () => {
  for (const c of CASES) {
    it(`${c.name}: the editor/homepage SVG decodes to the expected payload`, async () => {
      const value = encodePayload(c.content);
      const out = composeLayout(layout, value);
      expect(out.scan.ok).toBe(true);
      expect(await decodeSvg(out.svg, 900)).toBe(c.expected);
    });

    it(`${c.name}: the exported PNG decodes to the expected payload`, async () => {
      const { svg, width } = composeLayout(layout, encodePayload(c.content));
      const png = rasterizeSvg(svg, { width: width * 2 });
      expect(await decodeImage(png)).toBe(c.expected);
    });
  }

  it("no package or lockfile depends on qr-code-styling", () => {
    for (const file of ["package.json", "packages/qr-core/package.json", "pnpm-lock.yaml"])
      expect(readFileSync(file, "utf8"), file).not.toContain("qr-code-styling");
  });
});
