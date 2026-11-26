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
  /** Also use the machine's installed fonts (default). Tests turn this off to prove a file needs only its own fonts. */
  systemFonts?: boolean;
  background?: string;
  /**
   * HEY-180: the print resolution, written to the PNG as its pHYs chunk (pixels per metre) so layout and print software
   * open the file at its physical size. Without it a PNG is read as 72 dpi: a 300 dpi 90 × 50 mm card would place at
   * 375 × 208 mm. Leave it out for screen files.
   */
  dpi?: number;
}

export function resvgOptions(o: RasterOptions): ResvgRenderOptions {
  return {
    fitTo: { mode: "width", value: Math.round(o.width) },
    background: o.background,
    font: { fontFiles: o.fontFiles ?? [], loadSystemFonts: o.systemFonts ?? true, defaultFontFamily: "DM Sans" },
    shapeRendering: 2,
    textRendering: 1,
  };
}

/** Renders an SVG to a PNG buffer at the requested pixel width (with its dpi recorded when one is given). */
export function rasterizeSvg(svg: string, options: RasterOptions): Buffer {
  const png = new Resvg(svg, resvgOptions(options)).render().asPng();
  return options.dpi ? withResolution(png, options.dpi) : png;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The PNG with a pHYs chunk for `dpi` (pixels per metre, unit 1), right after IHDR as the PNG spec requires (before
 * IDAT). An existing pHYs chunk is replaced. The pixels are untouched.
 */
export function withResolution(png: Buffer, dpi: number): Buffer {
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data[8] = 1;
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  chunk.write("pHYs", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 17)), 17);
  const parts: Buffer[] = [png.subarray(0, 8)];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p);
    const type = png.toString("ascii", p + 4, p + 8);
    const end = p + 12 + len;
    if (type !== "pHYs") parts.push(png.subarray(p, end));
    if (type === "IHDR") parts.push(chunk);
    p = end;
  }
  return Buffer.concat(parts);
}
