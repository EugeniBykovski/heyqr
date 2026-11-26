// @vitest-environment jsdom
import { composeLayout } from "@heyqr/qr-core";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTION_MAX_CHARS,
  captionLength,
  checkCaption,
  DEFAULT_DESIGN,
  designToLayout,
  readDraftDesign,
  serializeDraftDesign,
  type EditorDesign,
} from "@/entities/qr";
import messages from "../../../messages/en.json";
import { CaptionField } from "./caption-field";

afterEach(cleanup);

const AT_LIMIT = `${"Little Fern Café · seasonal menu & wifi"}\n${"Scan at your table, order, pay in-app!!!"}`;

describe("caption length rule (HEY-43)", () => {
  it("counts characters as people see them; a line break is one", () => {
    expect(AT_LIMIT).toHaveLength(80);
    expect(captionLength(AT_LIMIT)).toBe(80);
    expect(captionLength("👩🏽‍💻")).toBe(1); // ZWJ sequence with skin tone: 7 UTF-16 units
    expect(captionLength("🇺🇦")).toBe(1);
    expect(captionLength("Ё̈é")).toBe(2); // combining marks stay with their letter
    expect(captionLength("Привет")).toBe(6);
    expect(captionLength("a\r\nb")).toBe(3); // CRLF is one line break
  });

  it("empty and exactly-at-limit are valid; one more character or a third line is not", () => {
    expect(checkCaption("")).toEqual({ ok: true, length: 0 });
    expect(checkCaption(AT_LIMIT)).toEqual({ ok: true, length: CAPTION_MAX_CHARS });
    expect(checkCaption(`${AT_LIMIT}!`)).toEqual({ ok: false, length: 81, reason: "tooLong" });
    expect(checkCaption("😀".repeat(80)).ok).toBe(true); // 160 UTF-16 units, 80 characters
    expect(checkCaption("😀".repeat(81))).toMatchObject({ ok: false, reason: "tooLong" });
    expect(checkCaption("One\nTwo").ok).toBe(true);
    expect(checkCaption("One\nTwo\nThree")).toMatchObject({ ok: false, reason: "tooManyLines" });
  });
});

describe("Caption field (HEY-43)", () => {
  function Harness({
    initial,
    onValidity = () => {},
    font = "dm",
  }: {
    initial: string;
    onValidity?: (id: string, ok: boolean) => void;
    font?: "dm" | "instrument";
  }) {
    const [caption, setCaption] = useState(initial);
    return (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CaptionField id="caption" label="Caption text" value={caption} onAccept={setCaption} onValidity={onValidity} font={font} />
        <output data-testid="accepted">{caption}</output>
      </NextIntlClientProvider>
    );
  }
  const field = () => screen.getByLabelText("Caption text") as HTMLTextAreaElement;
  const accepted = () => screen.getByTestId("accepted").textContent;
  const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

  it("accepts up to the limit, keeps the last valid caption over it without truncating, and recovers when shortened", () => {
    const validity = vi.fn();
    render(<Harness initial="Scan me" onValidity={validity} />);
    type(AT_LIMIT);
    expect(accepted()).toBe(AT_LIMIT);
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("80/80")).toBeInTheDocument();

    type(`${AT_LIMIT}!`);
    expect(field().value).toBe(`${AT_LIMIT}!`); // shown as typed, not truncated
    expect(accepted()).toBe(AT_LIMIT); // preview and export keep the last valid caption
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("remove 1 character");
    expect(validity).toHaveBeenLastCalledWith("caption", false);

    const paste = "Long paste ".repeat(40);
    type(paste);
    expect(field().value).toBe(paste);
    expect(screen.getByRole("alert").textContent).toContain("remove 360 characters");
    expect(accepted()).toBe(AT_LIMIT);

    type("Scan for the menu\nTable 4");
    expect(accepted()).toBe("Scan for the menu\nTable 4");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(validity).toHaveBeenLastCalledWith("caption", true);
    cleanup();
    // The same Polish caption is fine in Onest and undrawable in Prata (no ż ł ś): a font change is caught too.
    const prata = vi.fn();
    render(<Harness initial="Zażółć gęślą jaźń" onValidity={prata} font="instrument" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Prata can’t draw ż ł ć ę ś ą ź ń");
    expect(prata).toHaveBeenLastCalledWith("caption", false);
  });

  it("a combined character at the limit is never split: 80 pass, 81 are refused whole", () => {
    // é as e + combining acute: one grapheme of two code points, which the caption fonts draw.
    render(<Harness initial="" />);
    type("e\u0301".repeat(80));
    expect(accepted()).toBe("e\u0301".repeat(80));
    type("e\u0301".repeat(81));
    expect(accepted()).toBe("e\u0301".repeat(80));
  });

  it("HEY-181: characters the caption font can't draw are refused with what to change, and block Export", () => {
    const validity = vi.fn();
    render(<Harness initial="Menu" onValidity={validity} />);
    type("Menu 👩🏽‍💻 扫码");
    expect(accepted()).toBe("Menu");
    expect(screen.getByRole("alert")).toHaveTextContent("Onest can’t draw 👩🏽‍💻 扫 码");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(validity).toHaveBeenLastCalledWith("caption", false);
    type("Menu · Меню");
    expect(accepted()).toBe("Menu · Меню");
    expect(validity).toHaveBeenLastCalledWith("caption", true);
  });

  it("clearing the field accepts an empty caption; pasted Windows line breaks are normalized", () => {
    render(<Harness initial="Scan me" />);
    type("");
    expect(accepted()).toBe("");
    type("Line one\r\nLine two");
    expect(accepted()).toBe("Line one\nLine two");
  });

  it("a caption saved before the rule (over 80) loads as is, without an error, until it is edited", () => {
    const legacy = "x".repeat(120);
    render(<Harness initial={legacy} />);
    expect(field().value).toBe(legacy);
    expect(screen.queryByRole("alert")).toBeNull();
    type(`${legacy}y`);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(accepted()).toBe(legacy);
  });
});

describe("caption persistence (HEY-43)", () => {
  it("accepted captions with Cyrillic, emoji, combining marks and a line break survive the draft round trip", () => {
    const caption = "Привет, мир! ☕ 👩🏽‍💻\nCafé é ñ Ё̈ — 🇺🇦";
    const design: EditorDesign = { ...DEFAULT_DESIGN, preset: "caption", caption };
    const read = readDraftDesign(JSON.parse(JSON.stringify(serializeDraftDesign(design))), DEFAULT_DESIGN);
    expect(read.ok && read.value.caption).toBe(caption);
  });

  it("older drafts with captions longer than the new limit still load (stored ceiling is unchanged)", () => {
    const caption = "y".repeat(150);
    const read = readDraftDesign(serializeDraftDesign({ ...DEFAULT_DESIGN, preset: "caption", caption }), DEFAULT_DESIGN);
    expect(read.ok && read.value.caption).toBe(caption);
  });
});

describe("caption rendering, shared by preview and export (HEY-43)", () => {
  const VALUE = "https://littlefern.cafe/menu?table=4";
  const svgOf = (caption: string) => composeLayout(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption }), VALUE).svg;

  it("an empty caption renders no caption text", () => {
    expect(svgOf("")).not.toContain("<text");
  });

  it("renders exactly the accepted text, one line per line break, escaped, in the caption font (HEY-44)", () => {
    const svg = svgOf("Fish & Chips <today>\nTable 4");
    const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
    expect(lines).toEqual(["Fish &amp; Chips &lt;today&gt;", "Table 4"]);
    expect(svg).toContain(`font-family="'HeyQR Onest', sans-serif"`);
  });

  it("the caption is display text: the code still decodes to the original payload", async () => {
    for (const caption of ["", AT_LIMIT, "Привет 👩🏽‍💻\n🇺🇦"]) expect(await decodeSvg(svgOf(caption), 900)).toBe(VALUE);
  });
});
