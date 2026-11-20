// @vitest-environment jsdom
import { composeLayout, encodeQr, renderQr } from "@heyqr/qr-core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeShared, DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";

/*
 * HEY-62: async results that finish late never land on a newer design. The logo intake (decoding an uploaded file) is
 * the editor's slow async step; here it is held open with a deferred promise so the order of events is exact.
 */
type Intake = { ok: true; href: string } | { ok: false; reason: "unreadable"; bytes: number };
const pending: { file: string; resolve: (r: Intake) => void }[] = [];
vi.mock("./logo-intake", () => ({
  intakeLogo: (file: File) =>
    new Promise<Intake>((resolve) => {
      pending.push({ file: file.name, resolve });
    }),
}));
const { DesignSettings } = await import("./design-settings");
const { LogoUploadTile } = await import("./logo-upload");

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const finish = async (file: string) => {
  const p = pending.find((x) => x.file === file);
  if (!p) throw new Error(`no pending intake for ${file}`);
  await act(async () => p.resolve({ ok: true, href: `data:image/png;base64,${file}` }));
};

let latest: EditorDesign = DEFAULT_DESIGN;
function Editor({ initial }: { initial: EditorDesign }) {
  const [design, setDesign] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignSettings
        group="logo"
        onGroupChange={() => undefined}
        design={design}
        value="https://littlefern.cafe/menu"
        onChange={(p) => {
          latest = { ...design, ...p };
          setDesign(latest);
        }}
      />
    </NextIntlClientProvider>
  );
}
const uploadInput = () => document.querySelector<HTMLInputElement>('[data-slot="logo-upload"] input[type=file]');

beforeEach(() => {
  pending.length = 0;
  latest = DEFAULT_DESIGN;
});
afterEach(cleanup);

describe("stale async results (HEY-62)", () => {
  it("of two uploads, only the newer one is applied, whichever finishes last", async () => {
    const onLogo = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LogoUploadTile selected={false} label="Upload" onLogo={onLogo} onFeedback={() => undefined} />
      </NextIntlClientProvider>,
    );
    const input = document.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) throw new Error("no input");
    fireEvent.change(input, { target: { files: [png("first.png")] } });
    fireEvent.change(input, { target: { files: [png("second.png")] } });
    await finish("second.png");
    await finish("first.png"); // the slow, older one ends last
    expect(onLogo.mock.calls).toEqual([["data:image/png;base64,second.png"]]);
  });

  it("an upload still being read when its picker goes away (another layout) is dropped", async () => {
    const onLogo = vi.fn();
    const view = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LogoUploadTile selected={false} label="Upload" onLogo={onLogo} onFeedback={() => undefined} />
      </NextIntlClientProvider>,
    );
    const input = document.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) throw new Error("no input");
    fireEvent.change(input, { target: { files: [png("layout-a.png")] } });
    view.unmount();
    await finish("layout-a.png");
    expect(onLogo).not.toHaveBeenCalled();
  });

  it("Remove logo while an upload is being read wins: the finished upload doesn't bring a logo back", async () => {
    render(<Editor initial={{ ...DEFAULT_DESIGN, logo: { kind: "icon", icon: "coffee" } }} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Logo source" })).getByRole("button", { name: "Upload logo" }));
    const input = uploadInput();
    if (!input) throw new Error("no input");
    fireEvent.change(input, { target: { files: [png("slow.png")] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(latest.logo).toEqual({ kind: "none" });
    await finish("slow.png");
    expect(latest.logo).toEqual({ kind: "none" });
    // With nothing changed meanwhile, an upload is applied as usual.
    fireEvent.change(input, { target: { files: [png("next.png")] } });
    await finish("next.png");
    expect(latest.logo).toEqual({ kind: "image", href: "data:image/png;base64,next.png" });
  });

  it("the canvas and its scan check share one composition per design; a new design is never served an old one", () => {
    const a = designToLayout({ ...DEFAULT_DESIGN, caption: "A", preset: "caption" });
    const b = designToLayout({ ...DEFAULT_DESIGN, caption: "B", preset: "caption", fg: "#1F4E8C" });
    const first = composeShared(a, "https://littlefern.cafe/menu");
    expect(composeShared(a, "https://littlefern.cafe/menu")).toBe(first);
    // Another layout object, value or transparency is its own composition, equal to composing it directly.
    expect(composeShared(b, "https://littlefern.cafe/menu").svg).toBe(composeLayout(b, "https://littlefern.cafe/menu").svg);
    expect(composeShared(a, "https://littlefern.cafe/other").svg).not.toBe(first.svg);
    expect(composeShared(a, "https://littlefern.cafe/menu", { transparent: true }).svg).toBe(
      composeLayout(a, "https://littlefern.cafe/menu", { transparent: true }).svg,
    );
    // Scan results follow their own design: a failing design doesn't inherit a pass.
    const unreadable = designToLayout({ ...DEFAULT_DESIGN, fg: "#FFFFFF", bg: "#FFFFFF" });
    expect(composeShared(a, "https://littlefern.cafe/menu").scan.ok).toBe(true);
    expect(composeShared(unreadable, "https://littlefern.cafe/menu").scan.ok).toBe(false);
  });

  it("the reused QR matrix is keyed by value and error correction: a logo (level H) never gets the level-M matrix", () => {
    const value = "https://littlefern.cafe/menu?table=12";
    const style = {
      pattern: "square" as const,
      eyeFrame: "square" as const,
      eyeBall: "square" as const,
      colors: { fg: "#000000", eye: "#000000", eyeIn: "#000000", bg: "#FFFFFF" },
    };
    const plain = renderQr(value, style);
    const withLogo = renderQr(value, {
      ...style,
      logo: { iconPath: "M0 0h1v1H0z", size: 0.2, plate: "circle", plateColor: "#FFFFFF", iconColor: "#000000" },
    });
    expect([plain.scan.ecl, withLogo.scan.ecl]).toEqual(["M", "H"]);
    expect(plain.scan.modules).toBe(encodeQr(value, "M").size);
    expect(withLogo.scan.modules).toBe(encodeQr(value, "H").size);
    // Rendering again (from the cache) gives the same artwork.
    expect(renderQr(value, style).inner).toBe(plain.inner);
    expect(renderQr(`${value}&x=1`, style).inner).not.toBe(plain.inner);
  });
});
