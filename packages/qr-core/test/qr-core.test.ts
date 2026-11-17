import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { decodeSvg, verifyScan } from "../src/node";
import {
  composeLayout,
  encodePayload,
  encodeQr,
  renderQr,
  renderQrSvg,
  type ErrorCorrectionLevel,
  type Layout,
  type QrStyle,
} from "../src";

function decodeMatrix(text: string, ecl: ErrorCorrectionLevel): string | null {
  const m = encodeQr(text, ecl);
  const scale = 6;
  const quiet = 4;
  const n = (m.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++)
      if (m.modules[y][x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + quiet) * scale + dy) * n + ((x + quiet) * scale + dx)) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
  return jsQR(data, n, n)?.data ?? null;
}

const base: QrStyle = {
  pattern: "square",
  eyeFrame: "square",
  eyeBall: "square",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
};

describe("encodeQr", () => {
  const samples = [
    "https://anareyes.studio/portfolio",
    "hi",
    "Привет, мир! ünïcødé ✓",
    "WIFI:T:WPA;S:Reyes Studio Guest;P:linen-orbit-42;;",
    "x".repeat(300),
  ];
  for (const text of samples)
    for (const ecl of ["L", "M", "Q", "H"] as const)
      it(`round-trips ${ecl} · ${text.slice(0, 24)}`, () => {
        expect(decodeMatrix(text, ecl)).toBe(text);
      });

  it("rejects content beyond version 20", () => {
    expect(() => encodeQr("x".repeat(2000), "H")).toThrow(/too long/);
  });
});

describe("renderQr", () => {
  const url = "https://anareyes.studio/portfolio";
  for (const pattern of ["square", "rounded", "dot", "diamond", "leaf", "fluid", "vbars", "hbars"] as const)
    it(`styled ${pattern} modules still decode`, async () => {
      const svg = renderQrSvg(url, { ...base, pattern, eyeFrame: "rounded", eyeBall: "circle" });
      expect(await verifyScan(svg, url)).toBe(true);
    });

  it("decodes with a centered icon on a plate", async () => {
    const svg = renderQrSvg(url, { ...base, pattern: "rounded", logo: { iconPath: "M12 2v20M2 12h20", size: 0.22, plate: "circle" } });
    expect(await decodeSvg(svg)).toBe(url);
  });

  it("flags a logo that hides too much and suggests the safe size", () => {
    const report = renderQr(url, { ...base, logo: { iconPath: "M0 0", size: 0.46, plate: "square" } }).scan;
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.code).toBe("logo");
    expect(report.maxLogoSize).toBeGreaterThan(0.1);
    expect(report.maxLogoSize).toBeLessThan(0.46);
  });

  it("flags low contrast and inverted colors", () => {
    expect(
      renderQr(url, { ...base, colors: { ...base.colors, fg: "#CCCCCC", eye: "#CCCCCC", eyeIn: "#CCCCCC" } }).scan.issues[0]?.code,
    ).toBe("contrast");
    expect(
      renderQr(url, { ...base, colors: { fg: "#FFFFFF", eye: "#FFFFFF", eyeIn: "#FFFFFF", bg: "#0D0D12" } }).scan.issues[0]?.code,
    ).toBe("invert");
  });
});

describe("composeLayout", () => {
  const layout = (over: Partial<Layout>): Layout => ({
    preset: "horizontal",
    unit: "mm",
    width: 90,
    height: 50,
    qrSize: 35,
    border: true,
    colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF", frame: "#0D0D12", caption: "#0D0D12" },
    style: { pattern: "rounded", eyeFrame: "rounded", eyeBall: "rounded" },
    caption: {
      text: "View portfolio\nanareyes.studio",
      fontFamily: "DM Sans, sans-serif",
      size: 14,
      weight: 700,
      align: "left",
      position: "after",
    },
    ...over,
  });

  it("business card keeps physical size in mm and decodes", async () => {
    const out = composeLayout(layout({}), "https://anareyes.studio/portfolio");
    expect(out.svg).toContain('width="90mm"');
    expect(await decodeSvg(out.svg, 1400)).toBe("https://anareyes.studio/portfolio");
  });

  for (const frameStyle of ["bar", "tab", "bubble", "pill", "corners", "circle", "ticket", "phone"] as const)
    it(`frame ${frameStyle} decodes`, async () => {
      const out = composeLayout(
        layout({
          preset: "frame",
          frameStyle,
          qrSize: 40,
          caption: { text: "Scan me", fontFamily: "DM Sans", size: 12, weight: 700, align: "center", position: "after" },
          colors: { fg: "#1D4743", eye: "#1D4743", eyeIn: "#1D4743", bg: "#FFFFFF", frame: "#5F5F5F", caption: "#FFFFFF" },
        }),
        "tel:+14155550142",
      );
      expect(await decodeSvg(out.svg, 900)).toBe("tel:+14155550142");
    });
});

describe("encodePayload", () => {
  it("encodes Wi-Fi with escaping", () => {
    expect(encodePayload({ type: "wifi", ssid: "Cafe;Guest", security: "WPA", password: "p:ss" })).toBe(
      "WIFI:T:WPA;S:Cafe\\;Guest;P:p\\:ss;;",
    );
  });
  it("normalizes bare domains", () => {
    expect(encodePayload({ type: "website", url: "anareyes.studio" })).toBe("https://anareyes.studio");
  });
  it("builds a calendar event", () => {
    expect(encodePayload({ type: "event", title: "Spring show", start: "2026-12-05T19:00" })).toContain("DTSTART:20261205T190000");
  });
});
