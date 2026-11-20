// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, QrPreview, type EditorDesign } from "@/entities/qr";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import messages from "../../../messages/en.json";
import { DesignSettings, type DesignGroup } from "./design-settings";

/* HEY-63: keyboard and touch fixes in the editor. */
afterEach(cleanup);

function Confirm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Poster
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent role="alertdialog" closeLabel="Keep editing">
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>Switch layouts?</DialogDescription>
          <Button onClick={() => setOpen(false)}>Keep editing</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Settings({ initial, group }: { initial: EditorDesign; group: DesignGroup }) {
  const [design, setDesign] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignSettings
        group={group}
        onGroupChange={() => undefined}
        design={design}
        value="https://anareyes.studio/portfolio"
        onChange={(p) => setDesign((d) => ({ ...d, ...p }))}
      />
    </NextIntlClientProvider>
  );
}

describe("keyboard and touch (HEY-63)", () => {
  it("a dialog opened from code returns focus to what opened it, by Escape and by its buttons", async () => {
    render(<Confirm />);
    const opener = screen.getByRole("button", { name: "Poster" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog").contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    fireEvent.click(opener);
    const keep = within(screen.getByRole("alertdialog"))
      .getAllByRole("button", { name: "Keep editing" })
      .find((b) => b.textContent === "Keep editing");
    if (!keep) throw new Error("no Keep editing button");
    fireEvent.click(keep);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("a preview without a label is decorative: its caption never becomes a card's accessible name", () => {
    const layout = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Layout B" });
    render(
      <>
        <button type="button">
          <QrPreview layout={layout} value="https://anareyes.studio/portfolio" label="" />
          Artwork
        </button>
        <QrPreview layout={layout} value="https://anareyes.studio/portfolio" label="Preview of Layout B" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Artwork" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Preview of Layout B" })).toBeInTheDocument();
  });

  it("the colour picker has its own name, distinct from the HEX field", () => {
    render(<Settings initial={DEFAULT_DESIGN} group="colors" />);
    expect(screen.getByLabelText("Modules color picker")).toHaveAttribute("type", "color");
    expect(screen.getByRole("textbox", { name: "HEX" })).toBeInTheDocument();
  });

  it("the active settings panel is no extra Tab stop; sliders let vertical swipes scroll the page", () => {
    render(<Settings initial={{ ...DEFAULT_DESIGN, logo: { kind: "icon", icon: "coffee" } }} group="logo" />);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("tabindex", "-1");
    const slider = screen.getByRole("slider");
    expect(slider.className).toContain("touch-pan-y");
    // A slider still moves with the keyboard (native range semantics).
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect((slider as HTMLInputElement).value).toBe("0.3");
  });
});
