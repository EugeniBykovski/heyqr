// @vitest-environment jsdom
import { composeLayout, layoutGeometry } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { decodeImage } from "@heyqr/qr-core/verify";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createLayoutRecord,
  DEFAULT_DESIGN,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  QUICK_STYLES,
  quickStylePatch,
  readDraftDesign,
  surpriseStyle,
  type EditorDesign,
} from "@/entities/qr";
import { serializeDraftDesign } from "@/entities/qr/model/design-schema";
import { HISTORY_MERGE_MS, useDesignHistory } from "./use-design-history";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/* Grouped Design workspace (design 1.6–1.16): Undo / Redo, quick styles and the settings the groups added. */
const VALUE = "https://anareyes.studio/portfolio";
const LOGO = `data:image/png;base64,${rasterizeSvg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="#1F4D3A"/></svg>`,
  { width: 200 },
).toString("base64")}`;
const base: EditorDesign = { ...DEFAULT_DESIGN, content: { type: "website", url: VALUE }, preset: "caption", caption: "View portfolio" };

/** The editor owns the state, exactly like QrEditor / LayoutEditor: a patch merged into the design. */
function useTestEditor(initial: EditorDesign) {
  const [design, setDesign] = useState(initial);
  const history = useDesignHistory(design, (p) => setDesign((d) => ({ ...d, ...p })));
  return { design, history };
}
const mountEditor = (initial: EditorDesign) => renderHook(useTestEditor, { initialProps: initial }).result;

describe("Undo / Redo (design 1.12)", () => {
  it("each change is one step; a quick style is one step; Undo and Redo walk back and forth", () => {
    vi.useFakeTimers();
    const r = mountEditor(base);
    expect([r.current.history.canUndo, r.current.history.canRedo]).toEqual([false, false]);
    act(() => r.current.history.change({ pattern: "dot" }));
    vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
    act(() => r.current.history.change(quickStylePatch(QUICK_STYLES[1])));
    expect(r.current.design).toMatchObject({ pattern: "rounded", fg: "#1F4E8C", bg: "#EEF3FA" });
    act(() => r.current.history.undo());
    expect(r.current.design).toMatchObject({ pattern: "dot", fg: base.fg, bg: base.bg });
    act(() => r.current.history.undo());
    expect(r.current.design.pattern).toBe(base.pattern);
    expect(r.current.history.canUndo).toBe(false);
    act(() => r.current.history.redo());
    act(() => r.current.history.redo());
    expect(r.current.design).toMatchObject({ pattern: "rounded", fg: "#1F4E8C" });
    expect(r.current.history.canRedo).toBe(false);
    vi.useRealTimers();
  });

  it("fast changes to the same setting merge (typing, sliders); another setting starts a new step", () => {
    vi.useFakeTimers();
    const r = mountEditor(base);
    for (const size of [0.2, 0.24, 0.28, 0.3]) {
      act(() => r.current.history.change({ logoSize: size }));
      vi.advanceTimersByTime(100);
    }
    act(() => r.current.history.change({ fg: "#1F4D3A" }));
    act(() => r.current.history.undo());
    expect(r.current.design).toMatchObject({ logoSize: 0.3, fg: base.fg });
    act(() => r.current.history.undo());
    expect(r.current.design.logoSize).toBe(base.logoSize);
    expect(r.current.history.canUndo).toBe(false);
    vi.useRealTimers();
  });

  it("a setting that was unset is cleared again by Undo; content, mode and name are never part of the history", () => {
    const r = mountEditor(base);
    act(() => r.current.history.change({ captionColor: "#8C2F4B", frameColor: "#1F4D3A" }));
    act(() => r.current.history.change({ content: { type: "website", url: "https://other.example" }, name: "Renamed" }));
    act(() => r.current.history.undo());
    expect([r.current.design.captionColor, r.current.design.frameColor]).toEqual([undefined, undefined]);
    expect([r.current.design.content, r.current.design.name]).toEqual([{ type: "website", url: "https://other.example" }, "Renamed"]);
  });
});

describe("quick styles", () => {
  it("set shapes and colours together, return the other colour roles to the code colour, and add nothing else", () => {
    const d = { ...base, eye: "#C8102E", frameColor: "#5B3BFF", captionColor: "#8C2F4B" };
    const next = { ...d, ...quickStylePatch(QUICK_STYLES[2]) };
    expect(Object.keys(quickStylePatch(QUICK_STYLES[2])).sort()).toEqual(
      ["art", "bg", "captionColor", "eye", "eyeBall", "eyeFrame", "eyeIn", "fg", "frameColor", "pattern"].sort(),
    );
    const l = designToLayout(next);
    expect(l.colors).toMatchObject({
      fg: "#8C2F4B",
      eye: "#8C2F4B",
      eyeIn: "#8C2F4B",
      bg: "#FBEFF2",
      frame: "#8C2F4B",
      caption: "#8C2F4B",
    });
    expect(JSON.stringify(serializeDraftDesign(next))).not.toContain('"id"');
  });
});

describe("quick styles and history (HEY-61)", () => {
  // A customized layout: shapes, colours, a corner colour, frame colour, caption, logo, size and art tint of its own.
  const custom: EditorDesign = {
    ...base,
    preset: "horizontal",
    pattern: "leaf",
    eyeFrame: "circle",
    eyeBall: "leaf",
    fg: "#9A4A22",
    bg: "#FFF6DA",
    eye: "#C8102E",
    frameColor: "#5B3BFF",
    captionColor: "#1F4E8C",
    caption: "Little Fern Coffee",
    logo: { kind: "icon", icon: "coffee" },
    logoSize: 0.26,
    size: { unit: "mm", qr: 35, width: 43.3, height: 52.9 },
    cardSize: { width: 90, height: 50 },
    art: { tint: "#1F5C45", tint2: "#EEF6F0" },
  };
  const outside = (d: EditorDesign) => ({
    content: d.content,
    preset: d.preset,
    caption: d.caption,
    logo: d.logo,
    logoSize: d.logoSize,
    size: d.size,
    cardSize: d.cardSize,
  });

  it("each of the six styles sets exactly the design's values; payload, layout, caption, logo and size stay", () => {
    const expected = {
      classic: ["square", "square", "square", "#0D0D12", "#FFFFFF"],
      soft: ["rounded", "rounded", "rounded", "#1F4E8C", "#EEF3FA"],
      dots: ["dot", "circle", "circle", "#8C2F4B", "#FBEFF2"],
      fluid: ["fluid", "cushion", "rounded", "#1F5C45", "#EEF6F0"],
      lines: ["vbars", "rounded", "circle", "#0D0D12", "#FBF7F0"],
      gem: ["diamond", "leaf", "diamond", "#4B2EE0", "#F5F3FF"],
    };
    expect(QUICK_STYLES.map((s) => s.id)).toEqual(Object.keys(expected));
    for (const s of QUICK_STYLES) {
      const next = { ...custom, ...quickStylePatch(s) };
      expect([next.pattern, next.eyeFrame, next.eyeBall, next.fg, next.bg]).toEqual(expected[s.id]);
      // Every colour role follows the style's ink again, and the art tint is cleared (design applyStyle).
      expect(designToLayout(next).colors).toMatchObject({ eye: s.fg, eyeIn: s.fg, frame: s.fg, caption: s.fg, bg: s.bg });
      expect(next.art).toBeUndefined();
      expect(outside(next)).toEqual(outside(custom));
      expect(designToLayout(next)).toMatchObject({ width: 90, height: 50, qrSize: 35 });
    }
  });

  it("two styles in a row are two steps; Undo restores the exact customized state, Redo the applied values", () => {
    const r = mountEditor(custom);
    act(() => r.current.history.change(quickStylePatch(QUICK_STYLES[0]), { step: true }));
    act(() => r.current.history.change(quickStylePatch(QUICK_STYLES[4]), { step: true }));
    const applied = r.current.design;
    act(() => r.current.history.undo());
    expect(r.current.design).toMatchObject({ pattern: "square", fg: "#0D0D12" });
    act(() => r.current.history.undo());
    expect(r.current.design).toEqual(custom);
    act(() => r.current.history.redo());
    act(() => r.current.history.redo());
    expect(r.current.design).toEqual(applied);
  });

  it("Surprise me differs visibly from the current look, and Redo replays the same result", () => {
    let seed = 0;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (const s of QUICK_STYLES) {
      for (let i = 0; i < 20; i++) {
        const next = surpriseStyle(s, random);
        expect(next.pattern).not.toBe(s.pattern);
        expect(`${next.fg}/${next.bg}`).not.toBe(`${s.fg}/${s.bg}`);
      }
    }
    const r = mountEditor(custom);
    act(() => r.current.history.change(quickStylePatch(surpriseStyle(r.current.design)), { step: true }));
    const surprised = r.current.design;
    act(() => r.current.history.undo());
    expect(r.current.design).toEqual(custom);
    act(() => r.current.history.redo());
    expect(r.current.design).toEqual(surprised);
  });

  it("a manual edit right after a style is its own step, even within the merge window", () => {
    vi.useFakeTimers();
    const r = mountEditor(custom);
    act(() => r.current.history.change(quickStylePatch(QUICK_STYLES[3]), { step: true }));
    act(() => r.current.history.change(quickStylePatch(QUICK_STYLES[3]))); // same keys, would merge without `step`
    vi.advanceTimersByTime(100);
    act(() => r.current.history.change({ pattern: "dot" }));
    act(() => r.current.history.undo());
    expect(r.current.design).toMatchObject({ pattern: "fluid", fg: "#1F5C45" });
    vi.useRealTimers();
  });
});

describe("settings added by the groups render, persist and decode", () => {
  const cases: [string, Partial<EditorDesign>, (svg: string, d: EditorDesign) => void][] = [
    ["caption in the code", { captionPosition: "inside", caption: "Menu" }, (svg) => expect(svg).toContain(">Menu<")],
    [
      "caption above the code",
      { captionPosition: "above" },
      (_svg, d) => {
        const g = layoutGeometry(designToLayout(d));
        expect(g.caption?.[1] ?? Infinity).toBeLessThan(g.qr[1]);
      },
    ],
    ["frame around the layout", { border: true, frameColor: "#1F4E8C" }, (svg) => expect(svg).toContain('stroke="#1F4E8C"')],
    [
      "frame colours",
      { preset: "frame", frameStyle: "bubble", caption: "Scan me", frameColor: "#1F5C45", frameTextColor: "#FFFFFF" },
      (svg) => expect(svg).toContain('fill="#1F5C45"'),
    ],
    [
      "icon on a colour tile",
      { logo: { kind: "icon", icon: "coffee" }, logoTile: true, eyeIn: "#C8102E" },
      (svg) => expect(svg).toContain('fill="#C8102E"'),
    ],
    [
      "logo and name above the code on a card",
      { preset: "vertical", logo: { kind: "image", href: LOGO }, logoPosition: "top", brandName: "Little Fern" },
      (svg) => {
        expect(svg).toContain(">Little Fern<");
        expect(svg.match(/<image /g)).toHaveLength(1);
      },
    ],
  ];
  for (const [name, patch, check] of cases)
    it(`${name}: canvas, save and reopen, PNG and SVG decode`, async () => {
      const d: EditorDesign = { ...base, ...patch };
      const layout = designToLayout(d);
      const { svg, scan } = composeLayout(layout, VALUE);
      check(svg, d);
      expect(scan.ok).toBe(true);
      // Saved and reopened through Edit design: the same settings, the same drawing.
      const record = createLayoutRecord(layout, designSettingsOf(d));
      if (!record) throw new Error("refused");
      const reopened = designFromSaved({ name: "Ana", model: "static", content: d.content }, record);
      expect(composeLayout(designToLayout(reopened), VALUE).svg).toBe(svg);
      // A record without editor settings (written by an older build) is read back from its layout.
      const legacy = designFromSaved({ name: "Ana", model: "static", content: d.content }, { schemaVersion: 1, layout: record.layout });
      expect(composeLayout(designToLayout(legacy), VALUE).svg).toBe(svg);
      // The guest draft keeps them too.
      const draft = readDraftDesign(JSON.parse(JSON.stringify(serializeDraftDesign(d))), DEFAULT_DESIGN);
      expect(draft.ok && composeLayout(designToLayout(draft.value), VALUE).svg).toBe(svg);
      const exported = (await renderExport(layout, VALUE, "svg", {})).body.toString();
      expect(await decodeImage(rasterizeSvg(exported, { width: 900 }))).toBe(VALUE);
      expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 1 })).body))).toBe(VALUE);
    }, 30_000);

  it("a top logo is only on cards with an uploaded image; elsewhere the image stays in the centre", () => {
    const d: EditorDesign = { ...base, logo: { kind: "image", href: LOGO }, logoPosition: "top" };
    expect(designToLayout(d).topLogoHref).toBeUndefined();
    expect(designToLayout(d).style.logo?.href).toBe(LOGO);
    expect(designToLayout({ ...d, preset: "horizontal" }).topLogoHref).toBe(LOGO);
  });

  it("saving refuses a top logo that breaks the logo rule, like a centre logo", () => {
    const layout = { ...designToLayout({ ...base, preset: "vertical" }), topLogoHref: "data:text/html;base64,PHNjcmlwdD4=" };
    expect(createLayoutRecord(layout)).toBeNull();
  });
});
