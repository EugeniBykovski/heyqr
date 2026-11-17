/**
 * Node-only: decode a rendered code with ZXing (the reference decoder in tests and CI scan checks).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { resvgOptions } from "./raster";

let zxingReady: Promise<unknown> | null = null;

function ensureZXing(): Promise<unknown> {
  if (!zxingReady) {
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
    const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
    zxingReady = prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
  }
  return zxingReady;
}

/**
 * Decodes the exact SVG that will be exported, at a phone-like resolution.
 * Returns the decoded text or null. Call it after every edit (debounced) and show
 * "Scan verified" only when the text equals the encoded value.
 */
export async function decodeSvg(svg: string, width = 720): Promise<string | null> {
  await ensureZXing();
  const image = new Resvg(svg, resvgOptions({ width, background: "#ffffff" })).render();
  const data = new Uint8ClampedArray(image.pixels);
  const results = await readBarcodes(
    { data, width: image.width, height: image.height, colorSpace: "srgb" },
    { formats: ["QRCode"], tryHarder: true },
  );
  return results[0]?.text ?? null;
}

/** Decodes at several sizes (small sticker to poster); passes only if every size returns the expected value. */
export async function verifyScan(svg: string, expected: string, widths: number[] = [300, 600, 1200]): Promise<boolean> {
  for (const w of widths) {
    if ((await decodeSvg(svg, w)) !== expected) return false;
  }
  return true;
}
