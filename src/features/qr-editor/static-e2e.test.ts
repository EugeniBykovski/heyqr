import { composeLayout, encodePayload, layoutCapacity, type QrContent } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, isContentComplete } from "@/entities/qr";
import { parseVCard } from "../../../packages/qr-core/test/vcard-reader";
import { parseWifi } from "../../../packages/qr-core/test/wifi-reader";
import { contentErrors } from "./content-validation";

/*
 * HEY-25: every static type end to end, from what the Content form produces to the file a customer downloads.
 *   form input → contentErrors (the editor's gate) → encodePayload → designToLayout + composeLayout (the SVG shown in
 *   the editor and exported) → rasterizeSvg at the export width (the PNG from /api/export) → ZXing.
 * Expected results are written out here or read back with test-only parsers, never with the production serializer.
 */

const LAYOUTS = {
  // Styled like a real design: dots, colour, caption under the code (ECL M).
  "styled, caption": designToLayout({
    ...DEFAULT_DESIGN,
    fg: "#1F5C45",
    pattern: "dot",
    eyeFrame: "circle",
    preset: "caption",
    caption: "Scan me",
  }),
  // A center icon switches the encoder to ECL H and covers part of the symbol.
  "center logo": designToLayout({ ...DEFAULT_DESIGN, fg: "#4B2EE0", pattern: "rounded", logo: { kind: "icon", icon: "coffee" } }),
};

/** The two artifacts a user gets: the on-screen SVG and the exported PNG (2× the layout width, as renderExport does). */
async function renderAndDecode(content: QrContent, layoutName: keyof typeof LAYOUTS) {
  expect(contentErrors(content)).toEqual({});
  expect(isContentComplete(content)).toBe(true);
  const layout = LAYOUTS[layoutName];
  const payload = encodePayload(content);
  expect(layoutCapacity(layout, payload).ok).toBe(true);
  const composed = composeLayout(layout, payload);
  expect(composed.scan.ok).toBe(true);
  const png = rasterizeSvg(composed.svg, { width: composed.width * 2 });
  const fromPng = await decodeImage(png);
  const fromSvg = await decodeSvg(composed.svg, 1000);
  return { payload, fromPng, fromSvg };
}

const LONG_RU = "Гостевой куратор и руководитель направления «Типографика ✦ брендинг» — 👩🏽‍💻 студия Рейес";
/** Still longer than one 75-octet vCard line, but short enough for the ECL H limit (382 bytes) with a center logo. */
const MID_RU = "Куратор «Типографика ✦ брендинг» — 👩🏽‍💻 студия"; // card: 376 of 382 bytes, title still folded

describe("Static QR types end to end (HEY-25)", () => {
  for (const layoutName of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) {
    it(`URL · ${layoutName}: a bare domain with path and query decodes to the exact normalized URL`, async () => {
      const r = await renderAndDecode({ type: "website", url: "  littlefern.cafe/menu/today?table=4&lang=en  " }, layoutName);
      expect(r.fromPng).toBe("https://littlefern.cafe/menu/today?table=4&lang=en");
      expect(r.fromSvg).toBe(r.fromPng);
    });

    it(`Text · ${layoutName}: multiline Unicode with an empty line, emoji and surrounding spaces decodes exactly`, async () => {
      const text = "  Привет, мир!\n\nCafé ☕ 👩🏽‍💻 — é ñ Ё̈  \nLast line ";
      const r = await renderAndDecode({ type: "text", text }, layoutName);
      expect(r.fromPng).toBe("  Привет, мир!\n\nCafé ☕ 👩🏽‍💻 — é ñ Ё̈  \nLast line ");
      expect([...(r.fromPng ?? "")]).toHaveLength(51);
      expect(r.fromSvg).toBe(r.fromPng);
    });

    it(`Wi-Fi · ${layoutName}: Unicode, delimiters and backslashes come back as the original fields`, async () => {
      const ssid = String.raw`Café;Guest:5G,"Lobby" ☕\Net`;
      const password = String.raw`p\a;s:s,"w"✓-synthetic\ `.trimEnd();
      const r = await renderAndDecode({ type: "wifi", ssid, security: "WPA", password, hidden: true }, layoutName);
      expect(parseWifi(r.fromPng ?? "")).toEqual({
        T: "WPA",
        S: String.raw`Café;Guest:5G,"Lobby" ☕\Net`,
        P: String.raw`p\a;s:s,"w"✓-synthetic\ `.trimEnd(),
        H: "true",
      });
      expect(r.fromSvg).toBe(r.fromPng);
    });

    it(`Wi-Fi · ${layoutName}: an open network decodes without any password, even one typed before switching`, async () => {
      const r = await renderAndDecode(
        { type: "wifi", ssid: "Гостевая сеть ☕", security: "nopass", password: "was-secured-1" },
        layoutName,
      );
      expect(parseWifi(r.fromPng ?? "")).toEqual({ T: "nopass", S: "Гостевая сеть ☕" });
      expect(r.fromPng).not.toContain("was-secured-1");
      expect(r.fromPng).not.toContain(";P:");
    });

    it(`Contact · ${layoutName}: a folded vCard with Unicode and escaped punctuation comes back as the original fields`, async () => {
      const title = layoutName === "center logo" ? MID_RU : LONG_RU;
      const contact: QrContent = {
        type: "contact",
        firstName: "Zoë;A,na",
        lastName: "Ковальчу\u0301к\\Reyes",
        title,
        company: "Reyes Studio; Co, Ltd",
        phone: "+1 415 555 0142",
        email: "zoe.test@example.com",
        website: "example.com/zoe?ref=qr,card",
      };
      if (layoutName === "center logo") {
        // The full card with the long title (458 bytes) is over the H limit: HEY-24 refuses it instead of rendering.
        expect(layoutCapacity(LAYOUTS["center logo"], encodePayload({ ...contact, title: LONG_RU }))).toMatchObject({
          ok: false,
          maxBytes: 382,
        });
      }
      const r = await renderAndDecode(
        {
          type: "contact",
          firstName: "Zoë;A,na",
          lastName: "Ковальчу́к\\Reyes",
          title,
          company: "Reyes Studio; Co, Ltd",
          phone: "+1 415 555 0142",
          email: "zoe.test@example.com",
          website: "example.com/zoe?ref=qr,card",
        },
        layoutName,
      );
      const decoded = r.fromPng ?? "";
      // The long title really was folded in the rendered code (CRLF + space), and lines end in CRLF only.
      expect(decoded).toMatch(/\r\n /);
      expect(decoded).not.toMatch(/[^\r]\n/);
      const card = parseVCard(decoded);
      expect(card).toMatchObject({
        begin: "BEGIN:VCARD",
        version: "3.0",
        end: "END:VCARD",
        firstName: "Zoë;A,na",
        lastName: "Ковальчу́к\\Reyes",
        fn: "Zoë;A,na Ковальчу́к\\Reyes",
        title,
        org: "Reyes Studio; Co, Ltd",
        tel: "+1 415 555 0142",
        email: "zoe.test@example.com",
        url: "https://example.com/zoe?ref=qr,card",
      });
      expect(r.fromSvg).toBe(r.fromPng);
    });
  }
});
