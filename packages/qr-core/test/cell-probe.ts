import { renderPixels } from "./pixel-probe";

const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/**
 * Renders a standalone symbol SVG at a whole number of pixels per module and reports, per module cell (quiet zone
 * included, cell (0,0) = top-left of the viewBox), how many pixels are the foreground or background colour.
 */
export function probeCells(svg: string, viewBox: number, pxPerModule: number, colors: { fg: string; bg: string }) {
  const img = renderPixels(svg, viewBox * pxPerModule);
  const [f, b] = [rgb(colors.fg), rgb(colors.bg)];
  const near = (i: number, c: number[], tol: number) =>
    [0, 1, 2].every((k) => Math.abs((img.data[i + k] ?? -999) - (c[k] ?? 0)) <= tol) && (img.data[i + 3] ?? 0) >= 253;
  /** Pixel (px, py) inside cell (cx, cy): "fg", "bg" or "mixed" (antialiased edge). */
  const pixel = (cx: number, cy: number, px: number, py: number) => {
    const i = ((cy * pxPerModule + py) * img.width + cx * pxPerModule + px) * 4;
    return near(i, f, 2) ? "fg" : near(i, b, 2) ? "bg" : "mixed";
  };
  const cell = (cx: number, cy: number) => {
    let fg = 0;
    let bg = 0;
    for (let py = 0; py < pxPerModule; py++)
      for (let px = 0; px < pxPerModule; px++) {
        const p = pixel(cx, cy, px, py);
        if (p === "fg") fg++;
        else if (p === "bg") bg++;
      }
    const all = pxPerModule * pxPerModule;
    return { fg, bg, all, kind: fg === all ? "fg" : bg === all ? "bg" : "mixed" } as const;
  };
  return { cell, pixel, width: img.width };
}
