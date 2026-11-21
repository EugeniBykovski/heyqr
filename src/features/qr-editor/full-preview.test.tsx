// @vitest-environment jsdom
import { composeLayout } from "@heyqr/qr-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { DesignStep } from "./design-step";

/* HEY-66: the full-screen preview (design 1.10) is a view of the latest design; it never touches the design or export. */
afterEach(cleanup);
const VALUE = "https://anareyes.studio/portfolio";
const card: EditorDesign = {
  ...DEFAULT_DESIGN,
  name: "Business card",
  content: { type: "website", url: VALUE },
  preset: "horizontal",
  caption: "View portfolio",
  size: { unit: "mm", qr: 35, width: 43.3, height: 52.9 },
  cardSize: { width: 90, height: 50 },
};

let latest: EditorDesign = card;
function Editor() {
  const [design, setDesign] = useState(card);
  const layout = designToLayout(design);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignStep
        design={design}
        onChange={(p) => {
          latest = { ...design, ...p };
          setDesign(latest);
        }}
        title="Business card"
        shown={{ layout, value: VALUE, rebuilding: false }}
        scan={composeLayout(layout, VALUE).scan}
        tooLong={null}
        showFieldErrors={false}
        onFieldValidity={() => undefined}
        action={() => <button type="button">Export</button>}
        bottomInfo={null}
        note=""
        initialGroup="caption"
      />
    </NextIntlClientProvider>
  );
}

describe("full-screen preview (HEY-66, design 1.10)", () => {
  it("shows the layout's own sizes, Done instead of ×, and the latest unsaved edit", () => {
    render(<Editor />);
    fireEvent.change(screen.getByRole("textbox", { name: /Caption text/ }), { target: { value: "Unsaved caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Open full-screen preview" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Business card" })).toBeInTheDocument();
    expect(dialog.textContent).toContain("90 mm × 50 mm");
    expect(dialog.textContent).toContain("35 × 35 mm");
    expect(dialog.textContent).toContain("PNG 1063 × 591 px");
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    expect(dialog.querySelector("svg")?.textContent).toContain("Unsaved caption");
  });

  it("zoom in the preview is a viewing preference: the design (and so every export) stays the same", async () => {
    render(<Editor />);
    const before = latest;
    const opener = screen.getByRole("button", { name: "Open full-screen preview" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Actual size" }));
    expect(within(dialog).getByRole("button", { name: "Actual size" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(latest).toBe(before);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
