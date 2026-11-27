/*
 * HeyQR SDK quickstart: create a Dynamic QR draft, then read its saved layout and destination.
 * Server-side only (Node.js 18 or later). HEYQR_API_KEY is a secret: keep it in your server's environment, never in
 * browser code or source control. This script never prints it.
 */
import { HeyQrClient, isHeyQrApiError } from "@simplex-packages/heyqr-sdk";

const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL;
if (!apiKey || !baseUrl) {
  console.error("Set HEYQR_API_KEY and HEYQR_BASE_URL first (see the SDK README).");
  process.exit(1);
}

const heyqr = new HeyQrClient({ apiKey, baseUrl, timeoutMs: 15_000 });

// A plain 512 × 512 px QR layout: HeyQR's default design, as the editor saves it.
const layout = {
  preset: "qr",
  unit: "px",
  width: 512,
  height: 512,
  qrSize: 512,
  border: false,
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF", frame: "#0D0D12", caption: "#0D0D12" },
  style: { pattern: "rounded", eyeFrame: "rounded", eyeBall: "rounded", logo: null },
  caption: { text: "", font: "dm", fontFamily: "'HeyQR Onest', sans-serif", weight: 700, size: 40, align: "center", position: "after" },
};

try {
  // 1. Create a Dynamic QR draft: its short link will send people to `destination`.
  const created = await heyqr.createQr({
    name: "Quickstart menu",
    mode: "dynamic",
    content: { type: "website", url: "https://example.com" },
    destination: "https://example.com/menu",
    layouts: [{ name: "Default", layout }],
  });
  const layoutId = created.layouts[0]?.id;
  if (!layoutId) throw new Error("The API returned no layout id.");

  // 2. Read the saved layout (its revision is a string) and the destination (its revision is a number).
  const saved = await heyqr.getLayout(created.id, layoutId);
  const destination = await heyqr.getDestination(created.id);

  console.log(
    JSON.stringify(
      {
        qrCodeId: created.id,
        status: created.status,
        layoutIds: created.layouts.map((l) => l.id),
        layout: { id: saved.id, name: saved.name, revision: saved.revision },
        destination: { url: destination.destination, revision: destination.revision, shortLink: destination.shortLink },
      },
      null,
      2,
    ),
  );
  console.log("Open Dashboard → My QR codes to see the draft.");
} catch (error) {
  if (!isHeyQrApiError(error)) throw error;
  console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  process.exitCode = 1;
}
