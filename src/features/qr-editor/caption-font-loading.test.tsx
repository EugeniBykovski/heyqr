// @vitest-environment jsdom
import { composeLayout } from "@heyqr/qr-core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { DesignCanvas } from "./design-canvas";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "fonts");
});

const VALUE = "https://littlefern.cafe/menu?table=4";
const layout = designToLayout({
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Ёлка Йод\nCafé",
  captionFont: "caveat",
  captionWeight: 700,
});

/** A document.fonts whose faces load only when the test says so. */
function fakeFonts() {
  const loaded = new Set<string>();
  let release: () => void = () => {};
  const pending = new Promise<void>((r) => (release = r));
  const fonts = {
    check: (q: string) => loaded.has(q),
    load: (q: string) => pending.then(() => void loaded.add(q)),
  };
  Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
  return { release };
}

const canvas = () => (
  <DesignCanvas
    layout={layout}
    value={VALUE}
    rebuilding={false}
    label="Preview"
    tooLongLabel="Too long"
    watermark="Preview"
    updatingLabel="Updating preview…"
  />
);

describe("caption fonts load before the preview counts as final (HEY-44)", () => {
  it("hides the caption and marks the canvas busy until the selected faces have loaded", async () => {
    const { release } = fakeFonts();
    const { container } = render(canvas());
    const root = container.querySelector("[data-caption-fonts]");
    expect(root?.getAttribute("data-caption-fonts")).toBe("loading");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(root?.className).toContain("[&_text]:invisible");
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(root?.getAttribute("data-caption-fonts")).toBe("ready");
    expect(root?.getAttribute("aria-busy")).toBeNull();
    expect(root?.className).not.toContain("invisible");
  });
});

describe("caption text ignores the host page's text settings (HEY-44)", () => {
  it("resets inherited features and spacing so the inline preview draws the exported glyphs", () => {
    const svg = composeLayout(layout, VALUE).svg;
    expect(svg).toContain(
      `style="font-feature-settings:normal;font-variant:normal;letter-spacing:normal;word-spacing:normal;font-synthesis:none"`,
    );
    expect(svg).toContain(`<text font-family="'HeyQR Caveat', cursive"`);
    expect([...svg.matchAll(/font-weight="(\d+)"/g)].map((m) => m[1])).toEqual(["700", "400"]);
  });
});
