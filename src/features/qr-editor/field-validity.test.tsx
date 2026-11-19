// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { DesignPanel } from "./design-panel";
import { FramePanel } from "./frame-panel";
import { SizePanel } from "./size-panel";

/*
 * HEY-57: Export (create) and Save (Edit design) stop at a typed field whose text isn't accepted. That report must follow
 * what the field shows. Reproduced in the browser: after a half-typed size, switching Screen/Print (or picking a size
 * preset) resynced the field to a valid value, yet Export stayed blocked on it for the rest of the session.
 * The harness tracks validity exactly like QrEditor and LayoutEditor.
 */
let invalid: string[] = [];
let latest: EditorDesign = DEFAULT_DESIGN;
function Editor({ initial }: { initial: EditorDesign }) {
  const [design, setDesign] = useState(initial);
  const [blocked, setBlocked] = useState<string[]>([]);
  const onValidity = useCallback(
    (id: string, valid: boolean) =>
      setBlocked((cur) => {
        const next = valid ? (cur.includes(id) ? cur.filter((x) => x !== id) : cur) : cur.includes(id) ? cur : [...cur, id];
        invalid = next;
        return next;
      }),
    [],
  );
  const onChange = (p: Partial<EditorDesign>) =>
    setDesign((d) => {
      latest = { ...d, ...p };
      return latest;
    });
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignPanel design={design} onChange={onChange} onColorValidity={onValidity} />
      <FramePanel design={design} onChange={onChange} onValidity={onValidity} />
      <SizePanel design={design} onChange={onChange} showErrors={false} onValidity={onValidity} />
      <output data-testid="blocked">{blocked.join(",")}</output>
    </NextIntlClientProvider>
  );
}
const open = (initial: EditorDesign) => {
  invalid = [];
  latest = initial;
  return render(<Editor initial={initial} />);
};
const input = (id: string) => {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error(`no field #${id}`);
  return el;
};
const type = (id: string, text: string) => fireEvent.change(input(id), { target: { value: text } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const withCaption: EditorDesign = { ...DEFAULT_DESIGN, preset: "caption", caption: "Little Fern" };

afterEach(cleanup);

describe("a typed field's validity follows what it shows (HEY-57)", () => {
  it("half-typed code size, then the unit switch: the field shows the converted size and nothing blocks Export", () => {
    open(withCaption);
    type("size-qr", "9");
    expect(invalid).toEqual(["size-qr"]);
    expect(latest.size).toBeUndefined(); // the committed size never took the partial value
    press(/^Print/);
    expect(input("size-qr").value).toBe("43.3");
    expect(latest.size?.unit).toBe("mm");
    expect(invalid).toEqual([]);
  });

  it("half-typed width, then a size preset", () => {
    open(withCaption);
    type("size-width", "1");
    expect(invalid).toEqual(["size-width"]);
    press(/^Square 1080/);
    expect([input("size-width").value, input("size-height").value]).toEqual(["1080", "1080"]);
    expect(invalid).toEqual([]);
  });

  it("half-typed caption size, then the unit switch", () => {
    open(withCaption);
    type("caption-size", "1");
    expect(invalid).toEqual(["caption-size"]);
    press(/^Print/);
    expect(input("caption-size").value).toBe("9.6");
    expect(invalid).toEqual([]);
  });

  it("half-typed colour, then Reset colors", () => {
    open({ ...DEFAULT_DESIGN, fg: "#1F4D3A" });
    type("color-fg", "#12");
    expect(invalid).toEqual(["color-fg"]);
    expect(latest.fg).toBe("#1F4D3A");
    press("Reset colors");
    expect(input("color-fg").value).toBe(DEFAULT_DESIGN.fg);
    expect(invalid).toEqual([]);
  });

  it("a field that still shows invalid text stays reported through unrelated changes, and recovers when fixed", () => {
    open(withCaption);
    type("size-qr", "9");
    press("Dots");
    press("Vertical card");
    type("color-bg", "#F7F1E6");
    expect(input("size-qr").value).toBe("9");
    expect(invalid).toEqual(["size-qr"]);
    expect([latest.pattern, latest.preset, latest.bg]).toEqual(["dot", "vertical", "#F7F1E6"]);
    type("size-qr", "600");
    expect(invalid).toEqual([]);
    expect(latest.size?.qr).toBe(600);
  });
});
