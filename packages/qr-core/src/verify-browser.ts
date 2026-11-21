/**
 * HEY-67: the scan check in the browser. The same ZXing reader as the Node checks (verify.ts), loaded on demand from
 * the app's own URL (never a CDN). Decodes the exact SVG the renderer produced, drawn on a canvas at a phone-like
 * resolution on white, so nothing leaves the device: no request to the code's destination, no recorded scan.
 */
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

let ready: Promise<unknown> | null = null;

function ensureReader(wasmUrl: string): Promise<unknown> {
  ready ??= prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
    fireImmediately: true,
  }).catch((error: unknown) => {
    ready = null; // a failed download can be retried
    throw error;
  });
  return ready;
}

/** The SVG's drawing size: its viewBox ratio scaled so the longer side is `size` px. */
function canvasSize(svg: string, size: number): { width: number; height: number } {
  const vb = svg.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
  const w = Number(vb?.[1] ?? 1);
  const h = Number(vb?.[2] ?? 1);
  const k = size / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Decodes a rendered layout SVG in the browser. Returns the decoded text, or null when no QR code can be read. */
export async function decodeSvgInBrowser(svg: string, options: { wasmUrl: string; size?: number }): Promise<string | null> {
  await ensureReader(options.wasmUrl);
  const { width, height } = canvasSize(svg, options.size ?? 960);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const results = await readBarcodes(ctx.getImageData(0, 0, width, height), { formats: ["QRCode"], tryHarder: true });
    return results[0]?.text ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
