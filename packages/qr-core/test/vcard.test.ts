import { describe, expect, it } from "vitest";
import { decodeSvg } from "../src/node";
import { encodePayload, renderQrSvg, type QrContent } from "../src";
import { parseVCard } from "./vcard-reader";

type Contact = Extract<QrContent, { type: "contact" }>;
const raw = String.raw;

const STYLE = {
  pattern: "square",
  eyeFrame: "square",
  eyeBall: "square",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
} as const;

const LONG = "Гостевой куратор и руководитель направления «Типографика ✦ брендинг» — 👩🏽‍💻 студия Рейес";

describe("Contact card as vCard 3.0 (HEY-23)", () => {
  it("writes a minimal card with the required properties only, CRLF line endings", () => {
    expect(encodePayload({ type: "contact", firstName: "Ana" })).toBe("BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Ana;;;\r\nFN:Ana\r\nEND:VCARD\r\n");
  });

  it("escapes \\ ; , and line breaks exactly once, distinct from the structured-value separators", () => {
    const vcard = encodePayload({
      type: "contact",
      firstName: "A;n,a",
      lastName: raw`Re\yes`,
      company: "Studio; Co, Ltd",
      title: "Lead\nDesigner",
    });
    expect(vcard).toContain(raw`N:Re\\yes;A\;n\,a;;;`);
    expect(vcard).toContain(raw`FN:A\;n\,a Re\\yes`);
    expect(vcard).toContain(raw`ORG:Studio\; Co\, Ltd`);
    expect(vcard).toContain(raw`TITLE:Lead\nDesigner`);
  });

  it("an embedded newline can't create an extra property", () => {
    const vcard = encodePayload({ type: "contact", firstName: "Ana", title: "x\r\nURL:https://evil.example\nEND:VCARD" });
    const parsed = parseVCard(vcard);
    expect(parsed.names).toEqual(["BEGIN", "VERSION", "N", "FN", "TITLE", "END"]);
    expect(parsed.title).toBe("x\nURL:https://evil.example\nEND:VCARD");
  });

  it("folds lines longer than 75 octets without splitting a UTF-8 character", () => {
    const vcard = encodePayload({ type: "contact", firstName: "Ana", title: LONG });
    const physical = vcard.split("\r\n");
    expect(physical.some((l) => l.startsWith(" "))).toBe(true);
    for (const line of physical) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(vcard).not.toContain("\uFFFD");
    expect(parseVCard(vcard).title).toBe(LONG);
  });

  it("omits empty optional properties and normalizes a bare website to https", () => {
    const vcard = encodePayload({ type: "contact", firstName: "Ana", phone: " ", email: "", website: "anareyes.studio" });
    expect(parseVCard(vcard).names).toEqual(["BEGIN", "VERSION", "N", "FN", "URL", "END"]);
    expect(parseVCard(vcard).url).toBe("https://anareyes.studio");
  });

  const cases: [string, Contact, Partial<ReturnType<typeof parseVCard>>][] = [
    ["minimal", { type: "contact", lastName: "Reyes" }, { firstName: "", lastName: "Reyes", fn: "Reyes" }],
    [
      "all fields",
      {
        type: "contact",
        firstName: "Ana",
        lastName: "Reyes",
        title: "Designer",
        company: "Reyes Studio",
        phone: "+1 415 555 0142",
        email: "ana@anareyes.studio",
        website: "anareyes.studio/portfolio",
      },
      {
        firstName: "Ana",
        lastName: "Reyes",
        fn: "Ana Reyes",
        org: "Reyes Studio",
        title: "Designer",
        tel: "+1 415 555 0142",
        email: "ana@anareyes.studio",
        url: "https://anareyes.studio/portfolio",
      },
    ],
    [
      "Unicode and combining marks",
      { type: "contact", firstName: "Zoë", lastName: "Ковальчу\u0301к", company: "Café ☕ 👩🏽‍💻" },
      { firstName: "Zoë", lastName: "Ковальчу\u0301к", org: "Café ☕ 👩🏽‍💻" },
    ],
    [
      "commas, semicolons and backslashes",
      { type: "contact", firstName: "A;n,a", lastName: raw`Re\yes`, company: "Studio; Co, Ltd", title: raw`C:\design, lead; 2x` },
      { firstName: "A;n,a", lastName: raw`Re\yes`, org: "Studio; Co, Ltd", title: raw`C:\design, lead; 2x` },
    ],
    ["multiline value", { type: "contact", firstName: "Ana", title: "Lead\nDesigner\r\nPrint" }, { title: "Lead\nDesigner\nPrint" }],
    ["long Unicode line (folded)", { type: "contact", firstName: "Ana", title: LONG }, { title: LONG }],
  ];
  for (const [name, content, expected] of cases)
    it(`decodes with ZXing and parses back exactly · ${name}`, async () => {
      const decoded = await decodeSvg(renderQrSvg(encodePayload(content), STYLE), 1000);
      if (decoded === null) throw new Error("no QR decoded");
      const parsed = parseVCard(decoded);
      expect(parsed.begin).toBe("BEGIN:VCARD");
      expect(parsed.version).toBe("3.0");
      expect(parsed.end).toBe("END:VCARD");
      expect(parsed).toMatchObject(expected);
      // ZXing decodes are CPU-bound; these timed out at the 5 s default on a CI runner (b20007c).
    }, 30_000);
});
