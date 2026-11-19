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
    expect(latest.size).toEqual({ unit: "px", qr: 780, width: 1920, height: 1080 });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "1350" } });
    expect(latest.size?.height).toBe(1350);
    expect(screen.getByText(/PNG export: 3840 × 2700 px/)).toBeInTheDocument();
  });

  it("an export attempt shows the error without a blur", () => {
    renderPanel(DEFAULT_DESIGN, true);
    fireEvent.change(qrField(), { target: { value: "5" } });
    expect(qrField()).toHaveAttribute("aria-invalid", "true");
  });
});
