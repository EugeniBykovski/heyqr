// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout, type EditorDesign } from "@/entities/qr";
import { createLayoutRecord, readLayoutRecord } from "@/entities/qr/model/design-schema";
import messages from "../../../messages/en.json";
import { DesignPanel } from "./design-panel";
import { loadDraft, writeDraft } from "./use-draft";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

let latest: EditorDesign = DEFAULT_DESIGN;
/** The Design step's panel, wired the way the editor wires it: patches merge into one draft. */
function Panel({ initial }: { initial: EditorDesign }) {
  const [design, setDesign] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignPanel
        design={design}
        onChange={(p) => {
          const next = { ...design, ...p };
          latest = next;
          setDesign(next);
        }}
      />
    </NextIntlClientProvider>
  );
}
const renderPanel = (initial: EditorDesign) => {
  latest = initial;
  return render(<Panel initial={initial} />);
};
/** The colours the preview and export render (designToLayout feeds both QrPreview and /api/export). */
const rendered = () => {
  const c = designToLayout(latest).colors;
  return { fg: c.fg, eye: c.eye, eyeIn: c.eyeIn, bg: c.bg };
};

describe("Colours in the Design editor (HEY-33)", () => {
  it("has Modules, Corner frames, Corner centers and Background; corners show the module colour until set", () => {
    renderPanel(DEFAULT_DESIGN);
    expect((screen.getByLabelText("Modules", { selector: "input:not([type=color])" }) as HTMLInputElement).value).toBe("#0D0D12");
    expect((screen.getByLabelText("Corner frames", { selector: "input:not([type=color])" }) as HTMLInputElement).value).toBe("#0D0D12");
    expect((screen.getByLabelText("Corner centers", { selector: "input:not([type=color])" }) as HTMLInputElement).value).toBe("#0D0D12");
    expect((screen.getByLabelText("Background", { selector: "input:not([type=color])" }) as HTMLInputElement).value).toBe("#FFFFFF");
  });

  it("each control changes only its own colour in what the preview and export render", () => {
    renderPanel(DEFAULT_DESIGN);
    const set = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label, { selector: "input:not([type=color])" }), { target: { value } });
    set("Corner frames", "#C8102E");
    expect(rendered()).toEqual({ fg: "#0D0D12", eye: "#C8102E", eyeIn: "#0D0D12", bg: "#FFFFFF" });
    set("Corner centers", "#1F4ED8");
    expect(rendered()).toEqual({ fg: "#0D0D12", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#FFFFFF" });
    set("Background", "#F7F1E6");
    expect(rendered()).toEqual({ fg: "#0D0D12", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" });
    // Once set, corners no longer follow the modules.
    set("Modules", "#1F4D3A");
    expect(rendered()).toEqual({ fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" });
    fireEvent.click(screen.getByRole("button", { name: "Reset colors" }));
    expect(rendered()).toEqual({ fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" });
  });

  it("unset corners follow a new module colour (legacy behaviour)", () => {
    renderPanel(DEFAULT_DESIGN);
    fireEvent.change(screen.getByLabelText("Modules", { selector: "input:not([type=color])" }), { target: { value: "#1F4D3A" } });
    expect(rendered()).toEqual({ fg: "#1F4D3A", eye: "#1F4D3A", eyeIn: "#1F4D3A", bg: "#FFFFFF" });
  });

  it("a reloaded guest draft and a saved variant restore the palette", () => {
    const palette = { fg: "#1F4D3A", eye: "#C8102E", eyeIn: "#1F4ED8", bg: "#F7F1E6" };
    const design: EditorDesign = { ...DEFAULT_DESIGN, ...palette, content: { type: "text", text: "Hi" } };
    writeDraft(design);
    const read = loadDraft();
    expect(read.status).toBe("restored");
    if (read.status === "restored") expect(designToLayout(read.design).colors).toMatchObject(palette);

    const record = createLayoutRecord(designToLayout(design), designSettingsOf(design));
    const back = readLayoutRecord(JSON.parse(JSON.stringify(record)));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.editor).toMatchObject(palette);
      expect(back.value.layout.colors).toMatchObject(palette);
    }
  });

  it("legacy drafts without corner colours still load, with corners in the module colour", () => {
    const legacy = { schemaVersion: 1, ...DEFAULT_DESIGN, fg: "#1F4D3A" } as Record<string, unknown>;
    delete legacy.eye;
    delete legacy.eyeIn;
    localStorage.setItem("heyqr:draft:v1", JSON.stringify(legacy));
    const read = loadDraft();
    expect(read.status).toBe("restored");
    if (read.status === "restored") {
      expect(read.design.eye).toBeUndefined();
      expect(designToLayout(read.design).colors).toMatchObject({ fg: "#1F4D3A", eye: "#1F4D3A", eyeIn: "#1F4D3A" });
    }
  });
});
