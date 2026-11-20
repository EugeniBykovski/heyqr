// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { SizePanel } from "./size-panel";

afterEach(cleanup);

let latest: EditorDesign = DEFAULT_DESIGN;
let invalid: string[] = [];
function Harness({ initial, force }: { initial: EditorDesign; force?: boolean }) {
  const [design, setDesign] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SizePanel
        design={design}
        showErrors={force}
        onValidity={(id, ok) => (invalid = ok ? invalid.filter((x) => x !== id) : invalid.includes(id) ? invalid : [...invalid, id])}
        onChange={(p) => {
          latest = { ...design, ...p };
          setDesign(latest);
        }}
      />
    </NextIntlClientProvider>
  );
}
const renderPanel = (initial: EditorDesign, force = false) => {
  latest = initial;
  invalid = [];
  return render(<Harness initial={initial} force={force} />);
};
const qrField = () => screen.getByLabelText("QR code size", { selector: "input:not([type=range])" }) as HTMLInputElement;

describe("Size panel (HEY-35)", () => {
  it("starts from the legacy size and applies a valid code size", () => {
    renderPanel(DEFAULT_DESIGN);
    expect(qrField().value).toBe("512");
    fireEvent.change(qrField(), { target: { value: "1080" } });
    expect(latest.size).toEqual({ unit: "px", qr: 1080, width: 512, height: 625 });
  });

  it("invalid text never reaches the design; the error shows on blur and clears when fixed", () => {
    renderPanel(DEFAULT_DESIGN);
    for (const text of ["", "10", "99999", "512.5", "abc"]) {
      fireEvent.change(qrField(), { target: { value: text } });
      expect(latest.size).toBeUndefined();
    }
    expect(qrField()).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(qrField());
    expect(qrField()).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(qrField().getAttribute("aria-describedby") ?? "")?.textContent).toContain("120 to 2400 px");
    expect(invalid).toEqual(["size-qr"]);
    fireEvent.change(qrField(), { target: { value: "720" } });
    expect(qrField()).not.toHaveAttribute("aria-invalid");
    expect(invalid).toEqual([]);
    expect(latest.size?.qr).toBe(720);
  });

  it("QR only and Frame lock the layout size to the code; With caption has width, height and screen presets", () => {
    const view = renderPanel({ ...DEFAULT_DESIGN, preset: "qr" });
    expect(screen.getByLabelText("Width")).toBeDisabled();
    expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("512");
    expect(screen.queryByRole("button", { name: "Slide 1920×1080" })).toBeNull();
    view.unmount();
    renderPanel({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me" });
    fireEvent.click(screen.getByRole("button", { name: "Slide 1920×1080" }));
    // HEY-59: a preset sets the canvas only; the chosen code size stays (it still fits).
    expect(latest.size).toEqual({ unit: "px", qr: 512, width: 1920, height: 1080 });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "1350" } });
    expect(latest.size?.height).toBe(1350);
    expect(screen.getByText(/PNG 3840 × 2700 px/)).toBeInTheDocument();
  });

  it("an export attempt shows the error without a blur", () => {
    renderPanel(DEFAULT_DESIGN, true);
    fireEvent.change(qrField(), { target: { value: "5" } });
    expect(qrField()).toHaveAttribute("aria-invalid", "true");
  });

  it("Print · mm: the unit switch converts the size, mm accepts one decimal, and print presets apply (HEY-36)", () => {
    renderPanel({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me" });
    fireEvent.click(screen.getByRole("button", { name: "Print · mm" }));
    expect(latest.size).toEqual({ unit: "mm", qr: 43.3, width: 43.3, height: 52.9 });
    fireEvent.change(qrField(), { target: { value: "25.5" } });
    expect(latest.size?.qr).toBe(25.5);
    fireEvent.change(qrField(), { target: { value: "25.55" } });
    fireEvent.blur(qrField());
    expect(latest.size?.qr).toBe(25.5);
    expect(document.getElementById(qrField().getAttribute("aria-describedby") ?? "")?.textContent).toContain("10 to 200 mm");
    fireEvent.click(screen.getByRole("button", { name: "A6 105×148" }));
    expect(latest.size).toEqual({ unit: "mm", qr: 25.5, width: 105, height: 148 });
    expect(screen.getByText(/PNG 1240 × 1748 px/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Screen · px" }));
    expect(latest.size?.unit).toBe("px");
  });

  it("HEY-59 cards: code size and canvas are independent, presets keep the code, a code too big is fitted and said", () => {
    const card = {
      ...DEFAULT_DESIGN,
      preset: "horizontal" as const,
      caption: "View portfolio",
      size: { unit: "mm" as const, qr: 35, width: 43.3, height: 52.9 },
    };
    const view = renderPanel(card);
    // The card's canvas is its design proportions until it is changed: 90 × 50 mm for a 35 mm code.
    expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("90");
    expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("50");
    expect(screen.getByText(/PNG 1063 × 591 px/)).toBeInTheDocument();
    // A new code size pins the canvas: the card stays 90 × 50 mm.
    fireEvent.change(qrField(), { target: { value: "30" } });
    expect([latest.size?.qr, latest.cardSize]).toEqual([30, { width: 90, height: 50 }]);
    view.unmount();
    // Width and height change the canvas only.
    const view2 = renderPanel({ ...card, cardSize: { width: 90, height: 50 } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "55" } });
    expect([latest.size?.qr, latest.cardSize]).toEqual([35, { width: 90, height: 55 }]);
    fireEvent.click(screen.getByRole("button", { name: "Sticker 50×62" }));
    expect([latest.size?.qr, latest.cardSize]).toEqual([35, { width: 50, height: 62 }]);
    view2.unmount();
    // A code taller than the card is drawn at the largest size that fits, and the panel says so.
    renderPanel({ ...card, size: { ...card.size, qr: 60 }, cardSize: { width: 90, height: 50 } });
    expect(screen.getByRole("status").textContent).toContain("drawn at 45 mm");
  });

  it("HEY-59: switching units converts a card's own canvas with the code", () => {
    renderPanel({
      ...DEFAULT_DESIGN,
      preset: "horizontal",
      caption: "x",
      size: { unit: "mm", qr: 35, width: 43.3, height: 52.9 },
      cardSize: { width: 90, height: 50 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Screen · px" }));
    expect(latest.size?.unit).toBe("px");
    expect(latest.cardSize).toEqual({ width: 1063, height: 591 });
  });
});
