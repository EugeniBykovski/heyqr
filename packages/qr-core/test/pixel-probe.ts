import { Resvg } from "@resvg/resvg-js";
import { resvgOptions } from "../src/raster";

/** Raw RGBA pixels of an SVG rendered with the production rasterizer settings (no background fill added). */
export function renderPixels(svg: string, width: number) {
  const image = new Resvg(svg, resvgOptions({ width })).render();
  return { data: image.pixels, width: image.width, height: image.height };
}
