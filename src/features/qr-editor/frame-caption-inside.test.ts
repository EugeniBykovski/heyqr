import { composeLayout, encodeQr, layoutGeometry, renderQrSvg, type QrStyle } from "@heyqr/qr-core";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it } from "vitest";
import {
  createLayoutRecord,
  DEFAULT_DESIGN,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  FRAME_STYLES,
  readDraftDesign,
  readLayoutRecord,
  serializeDraftDesign,
  type EditorDesign,
} from "@/entities/qr";
import { probeCells } from "../../../packages/qr-core/test/cell-probe";

/*
 * HEY-194 (design 1.15 Frame gallery, 1.16 Caption inside the code): a frame's text on the frame or in the code, the
 * caption below, above or in the code, one geometry for the preview and the export (composeLayout), and drafts and
 * saved layouts from before the change rendering exactly as before.
 */
const VALUE = "https://anareyes.studio/portfolio";
const base: EditorDesign = { ...DEFAULT_DESIGN, content: { type: "website", url: VALUE }, caption: "Scan me" };
const framed = (over: Partial<EditorDesign>): EditorDesign => ({ ...base, preset: "frame", frameStyle: "bar", ...over });

describe("frame text on the frame or in the code (HEY-194)", () => {
  for (const frameStyle of FRAME_STYLES)
    it(`${frameStyle}: on the frame keeps its label band; in the code drops it and draws the text in the code`, async () => {
      const onFrame = designToLayout(framed({ frameStyle }));
      const inCode = designToLayout(framed({ frameStyle, frameTextPosition: "inside" }));
      expect([onFrame.caption.position, inCode.caption.position]).toEqual(["after", "center"]);
      const [g1, g2] = [layoutGeometry(onFrame), layoutGeometry(inCode)];
      // Same frame and code box either way; only the label goes.
      expect(g2.frame).toEqual(g1.frame);
      expect(g2.qr).toEqual(g1.qr);
      expect(g2.caption).toBeNull();
      const out = composeLayout(inCode, VALUE);
      expect(out.svg).toContain(">Scan me</text>");
      expect(out.scan.ok).toBe(true);
      expect(await decodeSvg(out.svg, 900)).toBe(VALUE);
    });

  it("a frame saved before HEY-194 renders exactly as before, even with an inside caption left from another layout", () => {
    // A guest draft that once had "In the code" on QR + caption, then switched to a frame: the label stays on the frame.
    const legacy = framed({ captionPosition: "inside" });
    const before = { ...legacy };
    delete before.captionPosition;
    expect(designToLayout(legacy).caption.position).toBe("after");
    expect(composeLayout(designToLayout(legacy), VALUE).svg).toBe(composeLayout(designToLayout(before), VALUE).svg);
  });

  it("the scan check flags frame text that hides too much and clears after a shorter text or moving it to the frame", () => {
    // A short value is the smallest symbol, where a wide plate in the middle covers the most of it.
    const value = "https://hq.r/a";
    const scan = (over: Partial<EditorDesign>) => composeLayout(designToLayout(framed(over)), value).scan;
    const failing = scan({ caption: "MENU MENU MENU", frameTextPosition: "inside" });
    expect(failing.issues.map((i) => i.code)).toContain("text");
    expect(failing.ok).toBe(false);
    for (const fixed of [
      scan({ caption: "Menu", frameTextPosition: "inside" }),
      scan({ caption: "MENU MENU MENU", frameTextPosition: "frame" }),
    ]) {
      expect(fixed.issues.map((i) => i.code)).not.toContain("text");
      expect(fixed.ok).toBe(true);
    }
  });
});

describe("caption below, above or in the code (design 1.16)", () => {
  const caption = (preset: EditorDesign["preset"], captionPosition: EditorDesign["captionPosition"]) =>
    layoutGeometry(designToLayout({ ...base, preset, caption: "Menu", captionPosition }));

  it("QR + caption: below puts the band under the code, above over it, in the code makes the layout the square code", () => {
    const below = caption("caption", "below");
    const above = caption("caption", "above");
    const inside = caption("caption", "inside");
    expect(below.caption?.[1]).toBeGreaterThanOrEqual(below.qr[1] + below.qr[2] - 1e-9);
    expect((above.caption?.[1] ?? 0) + (above.caption?.[3] ?? 0)).toBeLessThanOrEqual(above.qr[1] + 1e-9);
    expect([inside.caption, inside.width, inside.height]).toEqual([null, inside.qr[2], inside.qr[2]]);
  });

  it("vertical card: above / below; horizontal card: right of the code (below) and left of it (above)", () => {
    const vBelow = caption("vertical", "below");
    const vAbove = caption("vertical", "above");
    expect(vBelow.caption?.[1]).toBeGreaterThan(vBelow.qr[1]);
    expect(vAbove.caption?.[1]).toBeLessThan(vAbove.qr[1]);
    const right = caption("horizontal", "below");
    const left = caption("horizontal", "above");
    expect(right.caption?.[0]).toBeGreaterThan(right.qr[0] + right.qr[2] - 1e-9);
    expect((left.caption?.[0] ?? 0) + (left.caption?.[2] ?? 0)).toBeLessThanOrEqual(left.qr[0] + 1e-9);
    expect(caption("horizontal", "inside").caption).toBeNull();
  });
});

describe("text in the code keeps the corner markers and the quiet zone clear", () => {
  const FG = "#0D0D12";
  const BG = "#FFFFFF";
  const PX = 12;
  const style = (text: string): QrStyle => ({
    pattern: "square",
    eyeFrame: "square",
    eyeBall: "square",
    colors: { fg: FG, eye: FG, eyeIn: FG, bg: BG },
    centerText: { text, bg: FG, color: BG, fontFamily: "DM Sans" },
  });

  // The widest text the plate allows (CENTER_TEXT_MAX characters, then the cap on its width) on short and long values.
  for (const value of ["https://hq.r/a", VALUE, `${VALUE}?campaign=spring-2026&src=poster`])
    it(`finders, separators and the quiet zone match the matrix (${value.length} characters)`, async () => {
      const svg = renderQrSvg(value, style("MENUMENUMENUMENU"));
      const m = encodeQr(value, "H");
      const n = m.size;
      const view = n + 8;
      const cells = probeCells(svg, view, PX, { fg: FG, bg: BG });
      const bad: string[] = [];
      for (let y = -4; y < n + 4; y++)
        for (let x = -4; x < n + 4; x++) {
          const quiet = x < 0 || y < 0 || x >= n || y >= n;
          const finder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
          if (!quiet && !finder) continue;
          const dark = !quiet && Boolean(m.modules[y]?.[x]);
          const got = cells.cell(x + 4, y + 4).kind;
          if (got !== (dark ? "fg" : "bg")) bad.push(`${x},${y}:${got}`);
        }
      expect(bad).toEqual([]);
      expect(await decodeSvg(svg, 900)).toBe(value);
    });
});

describe("drafts and saved layouts keep the frame text position (HEY-194)", () => {
  const design = framed({
    frameStyle: "ticket",
    frameTextPosition: "inside",
    frameColor: "#1F4E8C",
    frameTextColor: "#FFFFFF",
    caption: "Menu",
    captionFont: "grotesk",
    captionWeight: 500,
  });

  it("a guest draft round-trips it; a draft without it (before HEY-194) reads as on the frame", () => {
    const back = readDraftDesign(JSON.parse(JSON.stringify(serializeDraftDesign(design))), DEFAULT_DESIGN);
    expect(back.ok && back.value.frameTextPosition).toBe("inside");
    expect(back.ok && designToLayout(back.value)).toEqual(designToLayout(design));
    // As stored before HEY-194: the same JSON without the field.
    const old: Record<string, unknown> = JSON.parse(JSON.stringify(serializeDraftDesign(framed({ frameStyle: "ticket" }))));
    expect("frameTextPosition" in old).toBe(false);
    const read = readDraftDesign(old, DEFAULT_DESIGN);
    expect(read.ok && designToLayout(read.value).caption.position).toBe("after");
    expect(readDraftDesign({ ...old, frameTextPosition: "middle" }, DEFAULT_DESIGN).ok).toBe(false);
  });

  it("a saved layout reopens with it, from its editor settings and from the layout alone", () => {
    const layout = designToLayout(design);
    const record = createLayoutRecord(layout, designSettingsOf(design));
    if (!record) throw new Error("record");
    const stored = readLayoutRecord(JSON.parse(JSON.stringify(record)));
    if (!stored.ok) throw new Error("read");
    const qr = { name: design.name, model: design.model, content: design.content };
    expect(designToLayout(designFromSaved(qr, stored.value))).toEqual(layout);
    // Records without editor settings are rebuilt from the layout: "center" on a frame means in the code.
    const bare = createLayoutRecord(layout);
    if (!bare) throw new Error("bare");
    const reopened = designFromSaved(qr, bare);
    expect([reopened.frameTextPosition, designToLayout(reopened).caption.position]).toEqual(["inside", "center"]);
  });
});
