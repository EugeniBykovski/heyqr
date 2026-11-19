import { composeLayout, renderQrSvg, type EyeBallShape, type EyeFrameShape, type FrameStyle, type ModuleShape } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";

/*
 * HEY-32: a representative decode matrix for the production SVG path. Earlier tickets decode mostly captioned layouts
 * (HEY-25…31); this adds standalone symbols and framed layouts across Square / Dots / Rounded and Rounded / Circle
 * finders, so each module style meets each layout kind and each finder setting meets several styles.
 * Payloads are literal strings handed straight to the renderer: the expected result doesn't depend on the serializer.
 */
const URL = "https://littlefern.cafe/menu?table=4";
const TEXT = "Guest Wi-Fi: Little Fern\nПароль на стойке ☕";
const WIFI = "WIFI:T:WPA;S:Little Fern;P:synthetic\\;pass\\:42;;";

type Layout = { kind: "standalone" } | { kind: "captioned" } | { kind: "framed"; frame: FrameStyle };
type Case = { pattern: ModuleShape; eyeFrame: EyeFrameShape; eyeBall: EyeBallShape; layout: Layout; payload: string };

const CASES: Case[] = [
  { pattern: "square", eyeFrame: "rounded", eyeBall: "rounded", layout: { kind: "standalone" }, payload: URL },
  { pattern: "square", eyeFrame: "circle", eyeBall: "circle", layout: { kind: "framed", frame: "bar" }, payload: TEXT },
  { pattern: "square", eyeFrame: "circle", eyeBall: "rounded", layout: { kind: "captioned" }, payload: WIFI },
  { pattern: "dot", eyeFrame: "circle", eyeBall: "circle", layout: { kind: "standalone" }, payload: TEXT },
  { pattern: "dot", eyeFrame: "rounded", eyeBall: "rounded", layout: { kind: "framed", frame: "pill" }, payload: URL },
  { pattern: "dot", eyeFrame: "rounded", eyeBall: "circle", layout: { kind: "captioned" }, payload: WIFI },
  { pattern: "rounded", eyeFrame: "circle", eyeBall: "circle", layout: { kind: "standalone" }, payload: WIFI },
  { pattern: "rounded", eyeFrame: "rounded", eyeBall: "rounded", layout: { kind: "captioned" }, payload: TEXT },
  { pattern: "rounded", eyeFrame: "circle", eyeBall: "circle", layout: { kind: "framed", frame: "phone" }, payload: URL },
];

const layoutName = (l: Layout) => (l.kind === "framed" ? `framed (${l.frame})` : l.kind);
const caseName = (c: Case) => `${c.pattern} modules · ${c.eyeFrame} frame + ${c.eyeBall} centre finders · ${layoutName(c.layout)}`;

/** The SVG exactly as preview/export produce it, plus the two raster widths: export default (2×) and a small and large print. */
function render(c: Case): { svg: string; widths: [number, number] } {
  const colors = { fg: "#1F4D3A", eye: "#1F4D3A", eyeIn: "#C8643B", bg: "#FFFFFF" };
  if (c.layout.kind === "standalone")
    return {
      svg: renderQrSvg(c.payload, { pattern: c.pattern, eyeFrame: c.eyeFrame, eyeBall: c.eyeBall, colors }, 512),
      widths: [512, 1536],
    };
  const layout = designToLayout({
    ...DEFAULT_DESIGN,
    pattern: c.pattern,
    eyeFrame: c.eyeFrame,
    eyeBall: c.eyeBall,
    fg: colors.fg,
    ...(c.layout.kind === "framed"
      ? { preset: "frame", frameStyle: c.layout.frame, caption: "Scan for the menu" }
      : { preset: "caption", caption: "Scan me" }),
  });
  const { svg, width } = composeLayout(layout, c.payload);
  return { svg, widths: [Math.round(width), Math.round(width * 3)] };
}

describe("SVG decode matrix (HEY-32)", () => {
  it("covers every module style in every layout kind, and every finder setting with several styles", () => {
    const pairs = (f: (c: Case) => string) => new Set(CASES.map(f));
    expect(pairs((c) => `${c.pattern}/${c.layout.kind}`).size).toBe(9);
    for (const finder of ["rounded/rounded", "circle/circle", "circle/rounded", "rounded/circle"])
      expect(
        CASES.some((c) => `${c.eyeFrame}/${c.eyeBall}` === finder),
        finder,
      ).toBe(true);
  });

  for (const c of CASES)
    it(caseName(c), async () => {
      const first = render(c);
      expect(render(c).svg, "second render must be byte-identical").toBe(first.svg);
      for (const width of first.widths) {
        const decoded = await decodeImage(rasterizeSvg(first.svg, { width }));
        expect(decoded, `decode at ${width} px`).toBe(c.payload);
      }
    });
});
