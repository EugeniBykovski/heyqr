/**
 * Node-only: render an SVG to PNG with resvg. Used by the export route for paid PNG files.
 * Kept separate from the ZXing decoder so the web server bundle never loads the decoder's wasm.
 */
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

export interface RasterOptions {
  /** Output width in pixels. */
  width: number;
  /** Fonts for captions, e.g. bundled DM Sans files. */
  fontFiles?: string[];
  background?: string;
}

export function resvgOptions(o: RasterOptions): ResvgRenderOptions {
  return {
    fitTo: { mode: "width", value: Math.round(o.width) },
    background: o.background,
    font: { fontFiles: o.fontFiles ?? [], loadSystemFonts: true, defaultFontFamily: "DM Sans" },
    shapeRendering: 2,
    textRendering: 1,
  };
}

/** Renders an SVG to a PNG buffer at the requested pixel width. */
export function rasterizeSvg(svg: string, options: RasterOptions): Buffer {
  return new Resvg(svg, resvgOptions(options)).render().asPng();
}
