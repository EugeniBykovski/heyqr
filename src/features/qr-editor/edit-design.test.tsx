// @vitest-environment jsdom
import { captionFontSize, composeLayout, layoutGeometry } from "@heyqr/qr-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTION_SIZE_LIMITS,
  convertCaptionSize,
  createLayoutRecord,
  DEFAULT_DESIGN,
  defaultCaptionSize,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  ORIGINAL_CAPTION_FONT,
  parseCaptionSize,
  pickLayoutForEdit,
  readDraftDesign,
  type EditorDesign,
} from "@/entities/qr";
import messages from "../../../messages/en.json";
import { CaptionSizeField } from "./caption-size-field";

afterEach(cleanup);

const VALUE = "https://littlefern.cafe/menu?table=4";
const qr = { name: "Little Fern", model: "static" as const, content: { type: "website" as const, url: VALUE } };

describe("Edit design: which layout opens (HEY-45)", () => {
  const layouts = [{ id: "l1" }, { id: "l2" }, { id: "l3" }];
  it("opens the requested layout, the first one without a layout, and nothing for an unknown layout", () => {
    expect(pickLayoutForEdit(layouts, "l2")?.id).toBe("l2");
    expect(pickLayoutForEdit(layouts)?.id).toBe("l1");
    expect(pickLayoutForEdit(layouts, "someone-elses")).toBeUndefined();
    expect(pickLayoutForEdit([], undefined)).toBeUndefined();
  });
});

describe("Edit design: the editor restores the saved layout (HEY-45)", () => {
  it("restores type, content, mode, name and every design setting", () => {
    const d: EditorDesign = {
      ...DEFAULT_DESIGN,
      fg: "#1F4D3A",
      eye: "#C8102E",
      bg: "#F7F1E6",
      pattern: "dot",
      logo: { kind: "icon", icon: "coffee" },
      preset: "caption",
      caption: "Ёлка Йод\nCafé",
      captionFont: "fraunces",
      captionWeight: 500,
      captionSize: 48,
      size: { unit: "px", qr: 1080, width: 1080, height: 1320 },
    };
    const record = createLayoutRecord(designToLayout(d), designSettingsOf(d));
    if (!record) throw new Error("invalid");
    const restored = designFromSaved({ ...qr, model: "dynamic" }, record);
    expect(restored).toEqual({ ...d, name: "Little Fern", model: "dynamic", content: qr.content });
    expect(designToLayout(restored)).toEqual(designToLayout(d));
  });

  it("a layout saved before caption fonts keeps DM Sans and its weight; one without a size keeps its drawn size", () => {
    const old = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me" });
    const legacy = { ...old, caption: { ...old.caption, font: undefined, fontFamily: "DM Sans, sans-serif", weight: 700 } };
    const record = createLayoutRecord(legacy, { ...designSettingsOf({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me" }) });
    if (!record) throw new Error("invalid");
    const restored = designFromSaved(qr, record);
    expect([restored.captionFont, restored.captionWeight, restored.captionSize]).toEqual([ORIGINAL_CAPTION_FONT, 700, undefined]);
    const again = designToLayout(restored);
    expect(again.caption).toEqual(legacy.caption); // same font string, weight and size: saving it changes nothing
    expect(composeLayout(again, VALUE).svg).toBe(composeLayout(legacy, VALUE).svg);
  });

  it("records from before editor settings ({ layout } only) are read back from the rendered layout", () => {
    const d: EditorDesign = {
      ...DEFAULT_DESIGN,
      fg: "#1F4E8C",
      pattern: "dot",
      preset: "frame",
      frameStyle: "bubble",
      caption: "Menu",
      logo: { kind: "icon", icon: "wifi" },
    };
    const record = createLayoutRecord(designToLayout(d));
    if (!record) throw new Error("invalid");
    const restored = designFromSaved(qr, record);
    expect([restored.fg, restored.pattern, restored.preset, restored.frameStyle, restored.caption, restored.logo]).toEqual([
      "#1F4E8C",
      "dot",
      "frame",
      "bubble",
      "Menu",
      { kind: "icon", icon: "wifi" },
    ]);
  });
});

describe("caption size (HEY-45)", () => {
  it("px 4–400 and pt 4–120 with one decimal; outside, empty or malformed is refused", () => {
    expect(CAPTION_SIZE_LIMITS).toEqual({ px: [4, 400], pt: [4, 120] });
    expect([
      parseCaptionSize("4", "px"),
      parseCaptionSize("400", "px"),
      parseCaptionSize("12,5", "pt"),
      parseCaptionSize("120", "pt"),
    ]).toEqual([4, 400, 12.5, 120]);
    for (const bad of ["3.9", "401", "", "12.55", "abc", "-5"]) expect(parseCaptionSize(bad, "px")).toBeNull();
    expect(parseCaptionSize("121", "pt")).toBeNull();
  });

  it("unset keeps the size older layouts were drawn at; a chosen size is used as is in px or pt", () => {
    expect(defaultCaptionSize({ unit: "px", qr: 512 })).toBe(40);
    expect(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "x" }).caption.size).toBe(40);
    expect(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "x", captionSize: 24 }).caption.size).toBe(24);
    const mm = { unit: "mm" as const, qr: 40, width: 50, height: 60 };
    expect(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "x", size: mm, captionSize: 18 }).caption.size).toBe(18);
  });

  it("switching px ↔ mm keeps the caption's share of the code", () => {
    const px = { unit: "px" as const, qr: 1000 };
    const mm = { unit: "mm" as const, qr: 84.7 };
    expect(convertCaptionSize(50, px, mm)).toBeCloseTo((0.05 * 84.7) / 0.3528, 0);
    expect(convertCaptionSize(convertCaptionSize(50, px, mm), mm, px)).toBeCloseTo(50, 0);
  });

  it("preview, SVG and PNG draw the same size: the renderer's one calculation, shrinking only when it doesn't fit", () => {
    const fits = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Menu", captionSize: 30 });
    expect(captionFontSize(fits, layoutGeometry(fits))).toBe(30);
    expect(composeLayout(fits, VALUE).svg).toContain('font-size="30"');
    const big = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan for the whole seasonal menu", captionSize: 400 });
    expect(captionFontSize(big, layoutGeometry(big))).toBeLessThan(400);
  });

  it("older drafts without a size still load", () => {
    const read = readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN, preset: "caption", caption: "x" }, DEFAULT_DESIGN);
    expect(read.ok && read.value.captionSize).toBeUndefined();
  });
});

describe("Caption → Size field (HEY-45)", () => {
  function Harness({ onValidity = () => {} }: { onValidity?: (id: string, ok: boolean) => void }) {
    const [design, setDesign] = useState<EditorDesign>({ ...DEFAULT_DESIGN, preset: "caption", caption: "Menu" });
    return (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CaptionSizeField design={design} onChange={(p) => setDesign((d) => ({ ...d, ...p }))} onValidity={onValidity} />
        <output data-testid="size">{designToLayout(design).caption.size}</output>
      </NextIntlClientProvider>
    );
  }
  const field = () => screen.getByLabelText("Size") as HTMLInputElement;
  const size = () => Number(screen.getByTestId("size").textContent);

  it("shows the default, takes min and max, keeps the last valid size on invalid input, and recovers", () => {
    const validity = vi.fn();
    render(<Harness onValidity={validity} />);
    expect(field().value).toBe("40");
    expect(screen.getByText("px")).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "4" } });
    expect(size()).toBe(4);
    fireEvent.change(field(), { target: { value: "400" } });
    expect(size()).toBe(400);
    expect(screen.getByText(/so the caption fits the layout/)).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "401" } });
    expect(size()).toBe(400);
    expect(field().value).toBe("401");
    expect(screen.getByRole("alert").textContent).toContain("Enter 4–400 px");
    expect(validity).toHaveBeenLastCalledWith("caption-size", false);
    fireEvent.change(field(), { target: { value: "abc" } });
    expect(size()).toBe(400);
    fireEvent.change(field(), { target: { value: "36" } });
    expect(size()).toBe(36);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(validity).toHaveBeenLastCalledWith("caption-size", true);
  });
});
