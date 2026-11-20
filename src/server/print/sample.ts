import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, SAMPLE_LOGO, type EditorDesign } from "../../entities/qr";
import { printPage } from "./print";

/*
 * Design 9.1 "Print Pack sample": what the Print Pack contains, shown with a fixed demo QR (Little Fern Coffee brand
 * card, 55 × 85 mm) rather than the user's own code, so a trial never hands out print files of a real code. The demo
 * code opens the Hey QR home page. Plain module so tests render the same sample.
 */
export const SAMPLE_PRINT_DESIGN: EditorDesign = {
  ...DEFAULT_DESIGN,
  name: "Little Fern Coffee",
  preset: "vertical",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  eye: "#1F4D3A",
  eyeIn: "#C8643B",
  caption: "Scan for the menu",
  logo: { kind: "image", href: SAMPLE_LOGO },
  logoPosition: "top",
  brandName: "Little Fern Coffee",
  size: { unit: "mm", qr: 41, width: 55, height: 85 },
};

export function samplePrint(appUrl: string) {
  const layout = designToLayout(SAMPLE_PRINT_DESIGN);
  const value = `${appUrl.replace(/\/$/, "")}/`;
  const page = printPage(layout, value, DEFAULT_PRINT_SETTINGS, { layoutId: "sample", revision: "v1" });
  return { layout, value, page, settings: DEFAULT_PRINT_SETTINGS };
}
