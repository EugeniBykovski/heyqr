import { composeLayout, encodePayload } from "@heyqr/qr-core";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { designToLayout, directContent, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { heroDesign } from "./hero-square";

/*
 * HEY-187: the homepage demo is a square (60 × 60 mm) QR + caption, not the 90 × 50 mm Business card, and it stays a
 * live, scannable code as the visitor edits it.
 */
describe("homepage square demo (HEY-187)", () => {
  const base = heroDesign(messages.home.tool.captionDefault);

  it("is a 60 × 60 mm square with the scan caption under the code", () => {
    const layout = designToLayout(base);
    expect([layout.preset, layout.unit, layout.width, layout.height, layout.qrSize]).toEqual(["caption", "mm", 60, 60, 44]);
    expect(layout.caption.text).toBe("Scan to see my portfolio");
    expect(layout.caption.weight).toBe(700);
  });

  it("scans as the visitor types, recolours and rewrites the caption", async () => {
    const edits: Partial<EditorDesign>[] = [
      { content: { type: "website", url: "https://anareyes.studio/portfolio" } },
      { content: { type: "website", url: "https://littlefern.cafe/menu?table=12" }, fg: "#1F5C45" },
      {
        content: { type: "wifi", ssid: "Fern Café guests", password: "kept-for-guests", security: "WPA", hidden: false },
        caption: "Join our Wi-Fi",
      },
    ];
    for (const edit of edits) {
      const d = { ...base, ...edit } as EditorDesign;
      const value = encodePayload(directContent(d.content));
      const c = composeLayout(designToLayout(d), value);
      expect(c.scan.ok, JSON.stringify(edit)).toBe(true);
      expect(await decodeSvg(c.svg), JSON.stringify(edit)).toBe(value);
    }
  });
});
