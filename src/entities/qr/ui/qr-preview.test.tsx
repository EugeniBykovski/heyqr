import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "../model/design";
import { QrPreview } from "./qr-preview";

/*
 * Previews never grow past the box they sit in (reported: the Custom / Branded chooser and the Brand card look card
 * drew the code beyond their cards). The box keeps the layout's proportions; the drawing is out of flow and contained.
 */
describe("QrPreview box", () => {
  it("keeps the layout's aspect ratio, fills at most its container and positions the SVG inside it", () => {
    const tall = designToLayout({ ...DEFAULT_DESIGN, preset: "vertical", caption: "Menu" });
    const html = renderToStaticMarkup(<QrPreview layout={tall} value="https://littlefern.coffee" label="Card" className="size-full" />);
    expect(html).toMatch(new RegExp(`aspect-ratio:${tall.width} / ${tall.height}`.replace(/ /g, "\\s?")));
    expect(html).toContain("max-h-full");
    expect(html).toContain("[&amp;&gt;svg]:absolute");
    // Only the outer SVG is resized; the nested code keeps its own position and size.
    expect(html.match(/width="100%"/g)?.length).toBe(1);
  });
});
