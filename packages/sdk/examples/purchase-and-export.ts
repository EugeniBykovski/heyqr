/*
 * HeyQR SDK: buy a Static QR code's files, then download (and re-download) its PNG and SVG.
 * Server-side only (Node.js 18 or later). HEYQR_API_KEY is a secret: keep it in your server's environment, never in
 * browser code or source control. This script never prints it, and the SDK never exposes the signed download links.
 *
 * 1. The first export of an unpaid Static code answers 402 payment_required with a paymentUrl: HeyQR's Export screen
 *    for this code, layout and format. The owner opens it, signed in, and completes Checkout. The API never charges.
 * 2. HeyQR unlocks the code when Stripe's webhook confirms the payment. Run this again with the same HEYQR_QR_ID and
 *    HEYQR_LAYOUT_ID (or set HEYQR_WAIT_SECONDS to keep retrying them): the PNG and SVG are saved to HEYQR_OUT_DIR.
 * 3. Then it exports both files again. Downloading again never creates an order, a charge or a credit deduction.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HeyQrClient, isHeyQrApiError, isPaymentRequired, type ExportedFile } from "@simplex-packages/heyqr-sdk";

const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL;
const qrCodeId = process.env.HEYQR_QR_ID;
const layoutId = process.env.HEYQR_LAYOUT_ID;
if (!apiKey || !baseUrl || !qrCodeId || !layoutId) {
  console.error("Set HEYQR_API_KEY, HEYQR_BASE_URL, HEYQR_QR_ID and HEYQR_LAYOUT_ID first (see the SDK README).");
  process.exit(1);
}
const outDir = process.env.HEYQR_OUT_DIR ?? "exports";
const waitSeconds = Number(process.env.HEYQR_WAIT_SECONDS ?? "0");

const heyqr = new HeyQrClient({ apiKey, baseUrl, timeoutMs: 30_000 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (file: ExportedFile) => createHash("sha256").update(file.bytes).digest("hex");

/** Both files of this code and layout, always the same two ids. */
async function exportBoth(): Promise<ExportedFile[]> {
  const png = await heyqr.downloadExport(qrCodeId as string, layoutId as string, { format: "png", scale: 2 });
  const svg = await heyqr.downloadExport(qrCodeId as string, layoutId as string, { format: "svg" });
  return [png, svg];
}

try {
  // 1. Export, or learn that the code still needs its purchase.
  let files: ExportedFile[] | null = null;
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let shownPaymentUrl = false;
  while (!files) {
    try {
      files = await exportBoth();
    } catch (error) {
      if (!isPaymentRequired(error)) throw error;
      if (!shownPaymentUrl) {
        console.log("Payment required (402). Open this page in a browser, signed in as the code's owner, and complete Checkout:");
        console.log(`  ${error.response.body.error.paymentUrl}`);
        shownPaymentUrl = true;
      }
      if (Date.now() >= deadline) {
        console.log(
          "The code isn't unlocked yet. HeyQR unlocks it once Stripe confirms the payment (usually within seconds);",
          "run this again with the same HEYQR_QR_ID and HEYQR_LAYOUT_ID.",
        );
        process.exit(2);
      }
      // Waiting for the webhook: retry the same code and layout.
      await sleep(5_000);
    }
  }

  // 2. Save the PNG and the SVG under their suggested names.
  await mkdir(outDir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const path = join(outDir, file.filename ?? `qr-code.${file.format}`);
    await writeFile(path, file.bytes);
    saved.push({ path, format: file.format, contentType: file.contentType, bytes: file.bytes.byteLength, delivery: file.delivery });
  }
  console.log(JSON.stringify({ saved }, null, 2));

  // 3. Export again: the same files, with no new order, charge or credit.
  const again = await exportBoth();
  const reExport = again.map((file, i) => ({
    format: file.format,
    bytes: file.bytes.byteLength,
    sameAsFirst: sha256(file) === sha256(files[i] as ExportedFile),
  }));
  console.log(JSON.stringify({ reExport }, null, 2));
} catch (error) {
  if (!isHeyQrApiError(error)) throw error;
  console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  process.exitCode = 1;
}
