import { describe, expect, it } from "vitest";
import { decodeSvg } from "../src/node";
import { encodePayload, renderQrSvg, type QrContent } from "../src";
import { parseWifi } from "./wifi-reader";

type Wifi = Extract<QrContent, { type: "wifi" }>;
const raw = String.raw;
const backslashEnd = (s: string) => `${s}\\`;

const STYLE = {
  pattern: "square",
  eyeFrame: "square",
  eyeBall: "square",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
} as const;

async function decodeWifi(content: Wifi) {
  const decoded = await decodeSvg(renderQrSvg(encodePayload(content), STYLE), 900);
  if (decoded === null) throw new Error("no QR decoded");
  return parseWifi(decoded);
}

describe("Wi-Fi payload (HEY-22)", () => {
  it('escapes ; : , " and \\ exactly once', () => {
    const payload = encodePayload({ type: "wifi", ssid: raw`Café;Guest:5G,"Lobby"`, security: "WPA", password: raw`a\b;c:d,e"f` });
    expect(payload).toBe(raw`WIFI:T:WPA;S:Café\;Guest\:5G\,\"Lobby\";P:a\\b\;c\:d\,e\"f;;`);
  });

  it("keeps a trailing backslash from swallowing the field separator", () => {
    expect(encodePayload({ type: "wifi", ssid: backslashEnd("Net"), security: "WPA", password: backslashEnd("secret12") })).toBe(
      raw`WIFI:T:WPA;S:Net\\;P:secret12\\;;`,
    );
  });

  it("maps WPA, WEP and no password, and adds H:true only for hidden networks", () => {
    expect(encodePayload({ type: "wifi", ssid: "A", security: "WEP", password: "12345" })).toBe("WIFI:T:WEP;S:A;P:12345;;");
    expect(encodePayload({ type: "wifi", ssid: "A", security: "WPA", password: "12345678", hidden: true })).toBe(
      "WIFI:T:WPA;S:A;P:12345678;H:true;;",
    );
    expect(encodePayload({ type: "wifi", ssid: "A", security: "nopass" })).toBe("WIFI:T:nopass;S:A;;");
  });

  it("leaves the password out of an open network even when one was typed before switching", () => {
    const payload = encodePayload({ type: "wifi", ssid: "Lobby", security: "nopass", password: "was-secured-1" });
    expect(payload).toBe("WIFI:T:nopass;S:Lobby;;");
    expect(payload).not.toContain("was-secured-1");
  });

  const cases: [string, Wifi, Record<string, string>][] = [
    [
      "reserved characters",
      { type: "wifi", ssid: raw`Café;Guest:5G,"Lobby"`, security: "WPA", password: raw`a\b;c:d,e"f` },
      { T: "WPA", S: raw`Café;Guest:5G,"Lobby"`, P: raw`a\b;c:d,e"f` },
    ],
    [
      "trailing backslash",
      { type: "wifi", ssid: backslashEnd("Net"), security: "WPA", password: backslashEnd("secret12") },
      { T: "WPA", S: backslashEnd("Net"), P: backslashEnd("secret12") },
    ],
    [
      "Unicode",
      { type: "wifi", ssid: "Гостевая сеть ☕ 👩🏽‍💻", security: "WPA", password: "пароль-ünï-✓-é" },
      { T: "WPA", S: "Гостевая сеть ☕ 👩🏽‍💻", P: "пароль-ünï-✓-é" },
    ],
    [
      "leading, trailing and double spaces",
      { type: "wifi", ssid: "  Studio  Guest ", security: "WPA", password: " two  spaces " },
      { T: "WPA", S: "  Studio  Guest ", P: " two  spaces " },
    ],
    [
      "hidden WEP network",
      { type: "wifi", ssid: "Back room", security: "WEP", password: "abcde", hidden: true },
      { T: "WEP", S: "Back room", P: "abcde", H: "true" },
    ],
    [
      "open network after a password was typed",
      { type: "wifi", ssid: "Lobby", security: "nopass", password: "was-secured-1" },
      { T: "nopass", S: "Lobby" },
    ],
  ];
  for (const [name, content, expected] of cases)
    it(`decodes with ZXing to exactly the entered settings · ${name}`, async () => {
      expect(await decodeWifi(content)).toEqual(expected);
    });
});
