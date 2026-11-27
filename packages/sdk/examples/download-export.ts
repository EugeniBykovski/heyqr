/*
 * HEY-163: download a layout's PNG and SVG with @simplex-packages/heyqr-sdk and save them.
 *
 *   HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
 *   HEYQR_BASE_URL=http://localhost:3000 \
 *   HEYQR_QR_ID=<qr id> HEYQR_LAYOUT_ID=<layout id> [HEYQR_OUT_DIR=.] \
 *   pnpm exec tsx packages/sdk/examples/download-export.ts
 *
 * An unpaid Static code (or a Dynamic code that isn't live) gets 402 payment_required with a paymentUrl: HeyQR's Export
 * screen for that code, layout and format. Open it signed in as the owner, pay (or activate), then run this again. The
 * SDK never opens it or retries for you, and downloading again never charges.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HeyQrClient, isHeyQrApiError, type DownloadExportError } from "@simplex-packages/heyqr-sdk";

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Set ${name}.`);
  return value;
};
const heyqr = new HeyQrClient({ apiKey: env("HEYQR_API_KEY"), baseUrl: env("HEYQR_BASE_URL", "http://localhost:3000") });
const qrCodeId = env("HEYQR_QR_ID");
const layoutId = env("HEYQR_LAYOUT_ID");
const outDir = env("HEYQR_OUT_DIR", ".");

try {
  const saved = [];
  for (const format of ["png", "svg"] as const) {
    // The API's own option names: format, plus dpi/scale/transparent for PNGs.
    const file = await heyqr.downloadExport(qrCodeId, layoutId, format === "png" ? { format, scale: 4 } : { format });
    const path = join(outDir, file.filename ?? `qr-code.${format}`);
    await writeFile(path, file.bytes);
    saved.push({ path, contentType: file.contentType, bytes: file.bytes.byteLength, delivery: file.delivery });
  }
  console.log(JSON.stringify(saved, null, 2));
} catch (error) {
  const r = (error as DownloadExportError).response;
  if (isHeyQrApiError(error) && r.status === 402) {
    console.error(`Payment required: open ${r.body.error.paymentUrl} as the code's owner, then run this again.`);
  } else if (isHeyQrApiError(error)) console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
}
