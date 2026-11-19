// @vitest-environment jsdom
import { isHexColor, parseHexColor } from "@heyqr/qr-core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import { readDraftDesign } from "@/entities/qr/model/design-schema";
import messages from "../../../messages/en.json";
import { DesignPanel } from "./design-panel";
import { loadDraft, writeDraft } from "./use-draft";

/*
 * HEY-34: one HEX rule, "#RRGGBB" in either letter case (qr-core isHexColor/parseHexColor, also behind the draft
 * schema). The text being edited is separate from the last valid colour; only valid colours reach the design.
 */
describe("the HEX rule", () => {
  it.each([
    ["#1f4d3a", "#1F4D3A"],
    ["#1F4D3A", "#1F4D3A"],
    ["#AbCdEf", "#ABCDEF"],
    ["  #c8102e ", "#C8102E"],
  ])("accepts %j as %s", (input, out) => expect(parseHexColor(input)).toBe(out));

  it.each(["", "#", "#1F4", "#1F4D3", "1F4D3A", "#1F4D3AA", "#1F4D3A00", "#GG0000", "#1F 4D3A", "#1F4D3Z", "rgb(0,0,0)", "red", "##1F4D3"])(
    "rejects %j",
    (input) => {
      expect(parseHexColor(input)).toBeNull();
      expect(isHexColor(input)).toBe(false);
    },
  );
});

let latest: EditorDesign = DEFAULT_DESIGN;
let invalid: string[] = [];
function Panel({ initial, forceErrors }: { initial: EditorDesign; forceErrors?: boolean }) {
  const [design, setDesign] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignPanel
        design={design}
        showColorErrors={forceErrors}
        onColorValidity={(id, ok) => (invalid = ok ? invalid.filter((x) => x !== id) : invalid.includes(id) ? invalid : [...invalid, id])}
        onChange={(p) => {
          latest = { ...design, ...p };
          setDesign(latest);
        }}
      />
    </NextIntlClientProvider>
  );
}
const renderPanel = (initial: EditorDesign = DEFAULT_DESIGN, forceErrors = false) => {
  latest = initial;
  invalid = [];
  return render(<Panel initial={initial} forceErrors={forceErrors} />);
};
const field = (label: string) => screen.getByLabelText(label, { selector: "input:not([type=color])" }) as HTMLInputElement;
const colors = () => {
  const c = designToLayout(latest).colors;
  return { fg: c.fg, eye: c.eye, eyeIn: c.eyeIn, bg: c.bg };
};
const errorOf = (input: HTMLInputElement) =>
  input.getAttribute("aria-describedby") ? document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent : null;

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("HEX fields in the Design panel (HEY-34)", () => {
  it("valid input in either case applies at once, normalized to upper case", () => {
    renderPanel();
    fireEvent.change(field("Corner frames"), { target: { value: "#c8102e" } });
    expect(colors()).toEqual({ fg: "#0D0D12", eye: "#C8102E", eyeIn: "#0D0D12", bg: "#FFFFFF" });
    fireEvent.change(field("Background"), { target: { value: "#F7F1E6" } });
    expect(colors().bg).toBe("#F7F1E6");
  });

  it("incomplete, invalid and wrong-length text never reaches the design; the error shows on blur and clears when fixed", () => {
    renderPanel();
    const fg = field("Modules");
    for (const text of ["", "#", "#1F4", "#1F4D3AA", "#1F4D3Z", "1F4D3A"]) {
      fireEvent.change(fg, { target: { value: text } });
      expect(fg.value).toBe(text); // the user can clear, type and paste freely
      expect(colors()).toEqual({ fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" });
    }
    // No error while typing; on blur an accessible, field-level error.
    expect(fg).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(fg);
    expect(fg).toHaveAttribute("aria-invalid", "true");
    expect(errorOf(fg)).toContain("#1F4D3A");
    expect(invalid).toEqual(["color-fg"]);
    // Correcting it applies the colour and clears the error.
    fireEvent.change(fg, { target: { value: "#1f4d3a" } });
    expect(fg).not.toHaveAttribute("aria-invalid");
    expect(errorOf(fg)).toBeNull();
    expect(invalid).toEqual([]);
    expect(colors().fg).toBe("#1F4D3A");
  });

  it("an invalid edit in one field leaves the other colours intact (and inherited corners keep following)", () => {
    renderPanel();
    fireEvent.change(field("Corner centers"), { target: { value: "#1F4ED8" } });
    fireEvent.change(field("Corner frames"), { target: { value: "#XYZ" } });
    fireEvent.change(field("Modules"), { target: { value: "#1F4D3A" } });
    // Frames weren't set (invalid text) so they follow the modules; centres keep their own colour.
    expect(colors()).toEqual({ fg: "#1F4D3A", eye: "#1F4D3A", eyeIn: "#1F4ED8", bg: "#FFFFFF" });
    expect(latest.eye).toBeUndefined();
  });

  it("Export attempted with an invalid edit: errors show without a blur", () => {
    renderPanel(DEFAULT_DESIGN, true);
    fireEvent.change(field("Background"), { target: { value: "#FFF" } });
    expect(field("Background")).toHaveAttribute("aria-invalid", "true");
    expect(latest.bg).toBe("#FFFFFF");
  });

  it("Reset colors replaces invalid text and clears the error", () => {
    renderPanel({ ...DEFAULT_DESIGN, fg: "#1F4D3A" });
    const fg = field("Modules");
    fireEvent.change(fg, { target: { value: "#12" } });
    fireEvent.blur(fg);
    fireEvent.click(screen.getByRole("button", { name: "Reset colors" }));
    expect(fg.value).toBe("#0D0D12");
    expect(fg).not.toHaveAttribute("aria-invalid");
  });

  it("a field that unmounts (another step) doesn't keep Export blocked", () => {
    const view = renderPanel();
    fireEvent.change(field("Modules"), { target: { value: "#1F" } });
    expect(invalid).toEqual(["color-fg"]);
    act(() => view.unmount());
    expect(invalid).toEqual([]);
  });

  it("the draft only ever holds valid colours; the corrected palette reloads and legacy drafts still load", () => {
    renderPanel();
    fireEvent.change(field("Corner frames"), { target: { value: "#C8102" } });
    writeDraft(latest);
    const stored = JSON.parse(localStorage.getItem("heyqr:draft:v1") ?? "{}") as Record<string, unknown>;
    expect(stored.eye).toBeUndefined();
    fireEvent.change(field("Corner frames"), { target: { value: "#c8102e" } });
    writeDraft(latest);
    const read = loadDraft();
    expect(read.status === "restored" && designToLayout(read.design).colors.eye).toBe("#C8102E");
    // A legacy draft (no corner colours) restores with corners in the module colour.
    const legacy = readDraftDesign({ ...DEFAULT_DESIGN, fg: "#1F4D3A" }, DEFAULT_DESIGN);
    expect(legacy.ok && designToLayout(legacy.value).colors).toMatchObject({ eye: "#1F4D3A", eyeIn: "#1F4D3A" });
    // A stored invalid colour is rejected by the same rule, so it can never be restored into the renderer.
    expect(readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN, eye: "#C8102" }, DEFAULT_DESIGN).ok).toBe(false);
  });
});
