import { CAPTION_FONT_IDS, supportedWeights, unsupportedCaptionChars } from "@heyqr/qr-core";
import { describe, expect, it } from "vitest";
import { createLayoutRecord, designSettingsOf } from "./design-schema";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "./design";

/*
 * HEY-181: the files embed only the caption font, so a caption (or frame label, or brand card name) with characters the
 * font can't draw would print empty boxes in the paid PDF. The one write check (createLayoutRecord, used by every save,
 * Edit design, Add layout and the public API) refuses such a layout.
 */
const record = (d: EditorDesign) => createLayoutRecord(designToLayout(d), designSettingsOf(d));

describe("caption font coverage (HEY-181)", () => {
  it("Latin, accented Latin and Cyrillic save in the default font; Han, Devanagari, Arabic, Thai and emoji don't", () => {
    for (const ok of ["Little Fern Café", "Zażółć gęślą jaźń · Ğüşİ", "Đường phố", "Ёлка Йод Іван ї ґ Ўсё", "Line one\nLine two"])
      expect(record({ ...DEFAULT_DESIGN, preset: "caption", caption: ok }), ok).not.toBeNull();
    for (const bad of ["扫码查看今日菜单", "मेनू देखें", "امسح", "เมนู", "Menu 🍕", "メニュー", "메뉴"])
      expect(record({ ...DEFAULT_DESIGN, preset: "caption", caption: bad }), bad).toBeNull();
  });

  it("coverage follows the chosen font: Prata lacks Polish letters, Golos Text and Caveat lack Vietnamese", () => {
    expect(
      unsupportedCaptionChars(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Zażółć", captionFont: "instrument" })),
    ).toEqual(["ż", "ł", "ć"]);
    expect(record({ ...DEFAULT_DESIGN, preset: "caption", caption: "Zażółć", captionFont: "instrument" })).toBeNull();
    expect(record({ ...DEFAULT_DESIGN, preset: "caption", caption: "Zażółć", captionFont: "fraunces" })).not.toBeNull();
    expect(record({ ...DEFAULT_DESIGN, preset: "caption", caption: "Đường", captionFont: "grotesk" })).toBeNull();
  });

  it("every font draws every character of its own picker sample and the editor's default texts", () => {
    for (const font of CAPTION_FONT_IDS)
      for (const weight of supportedWeights(font))
        for (const text of [
          "Scan me",
          "View portfolio",
          "Call me",
          "Menu",
          "Wi-Fi",
          "Pay here",
          "Review us",
          "Follow us",
          "Book now",
          "Ёлка",
        ])
          expect(unsupportedCaptionChars({ preset: "caption", caption: { text, font, weight } }), `${font} ${weight} ${text}`).toEqual([]);
  });

  it("a frame label and a brand card's name are checked; QR only draws no caption, so its text doesn't matter", () => {
    expect(record({ ...DEFAULT_DESIGN, preset: "frame", frameStyle: "bar", caption: "扫码" })).toBeNull();
    expect(record({ ...DEFAULT_DESIGN, preset: "qr", caption: "扫码" })).not.toBeNull();
    expect(
      unsupportedCaptionChars({
        preset: "vertical",
        caption: { text: "", font: "dm", weight: 700 },
        brandName: "小蕨",
        topLogoHref: "data:x",
      }),
    ).toEqual(["小", "蕨"]);
  });
});
