/*
 * Code shown on /developers (design 12.x "DEV"). Each snippet uses only the packages' public exports; the qr-core ones
 * are executed by developers.snippets.test.ts against the real package, so the page can't drift from the API.
 */
export const INSTALL = {
  npm: "npm install @heyqr/qr-core",
  pnpm: "pnpm add @heyqr/qr-core",
  yarn: "yarn add @heyqr/qr-core",
} as const;

export const SDK_INSTALL = {
  npm: "npm install @heyqr/sdk",
  pnpm: "pnpm add @heyqr/sdk",
  yarn: "yarn add @heyqr/sdk",
} as const;

export const SVG_SNIPPET = `import { encodePayload, renderQrSvg, type QrStyle } from "@heyqr/qr-core";

const value = encodePayload({ type: "website", url: "anareyes.studio/portfolio" });

const style: QrStyle = {
  pattern: "rounded",
  eyeFrame: "rounded",
  eyeBall: "circle",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#5B3BFF", bg: "#FFFFFF" },
};

// A standalone <svg> string, 512 × 512 px unless you pass another size.
const svg = renderQrSvg(value, style, 512);
document.querySelector("#qr")?.insertAdjacentHTML("beforeend", svg);`;

export const PNG_SNIPPET = `import { writeFile } from "node:fs/promises";
import { encodePayload, renderQrSvg } from "@heyqr/qr-core";
import { rasterizeSvg } from "@heyqr/qr-core/raster";

const value = encodePayload({
  type: "wifi",
  ssid: "Reyes Studio Guest",
  security: "WPA",
  password: "linen-orbit-42",
});

const svg = renderQrSvg(value, {
  pattern: "dot",
  eyeFrame: "circle",
  eyeBall: "circle",
  colors: { fg: "#1F4D3A", eye: "#1F4D3A", eyeIn: "#1F4D3A", bg: "#FFFFFF" },
});

// Rendered with resvg. Width in pixels; the height follows the SVG.
const png = rasterizeSvg(svg, { width: 1200 });
await writeFile("wifi-qr.png", png);`;

export const LOGO_SNIPPET = `import type { QrStyle } from "@heyqr/qr-core";

const style: QrStyle = {
  pattern: "rounded",
  eyeFrame: "cushion",
  eyeBall: "rounded",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
  // A 24 × 24 stroke path, or href: an image URL / data URI.
  logo: { iconPath: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20", size: 0.22, plate: "circle" },
};`;

export const SCAN_SNIPPET = `import { renderQr, type QrStyle } from "@heyqr/qr-core";

const style: QrStyle = {
  pattern: "dot",
  eyeFrame: "circle",
  eyeBall: "circle",
  colors: { fg: "#C9B7BC", eye: "#C9B7BC", eyeIn: "#C9B7BC", bg: "#FFFFFF" },
};

const { scan } = renderQr("https://reyes.studio", style);

if (!scan.ok) {
  for (const issue of scan.issues) console.warn(issue.code, issue.title, issue.fix);
}
// scan.maxLogoSize: the largest logo (share of the code width) that still scans.`;

export const AUTH_SNIPPET = `Authorization: Bearer hqk_<lookupId>_<secret>`;

export const CURL_CREATE = (base: string) => `curl -sS -X POST ${base}/api/v1/qr-codes \\
  -H "Authorization: Bearer $HEYQR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d @menu.json
# 201 { "id": "Q8d3…", "status": "draft", "layouts": [{ "id": "L2k9…" }] }`;

export const CURL_DESTINATION = (base: string) => `URL="${base}/api/v1/qr-codes/Q8d3…/destination"

# Read the current destination and its revision.
curl -sS "$URL" -H "Authorization: Bearer $HEYQR_API_KEY"
# → { "destination": "https://littlefern.cafe/menu", "revision": 3, … }

# Change it from that revision. An older revision gets 409 revision_conflict.
curl -sS -X PATCH "$URL" \\
  -H "Authorization: Bearer $HEYQR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "destination": "https://littlefern.cafe/today", "revision": 3 }'`;

export const CURL_EXPORT = (base: string) => `URL="${base}/api/v1/qr-codes/Q8d3…/layouts/L2k9…/export?format=png"

# Not paid or live yet: 402 payment_required with a paymentUrl for the owner.
curl -sS "$URL" -H "Authorization: Bearer $HEYQR_API_KEY"

# Paid: 302 to a short-lived signed link. curl drops the Authorization header on the redirect.
curl -sS -L -o menu.png "$URL" -H "Authorization: Bearer $HEYQR_API_KEY"`;

export const SDK_SNIPPET = `import { HeyQrClient, isRevisionConflict } from "@heyqr/sdk";

// Server only: the key is a secret. Keep it in the environment, never in browser code.
const heyqr = new HeyQrClient({ apiKey: process.env.HEYQR_API_KEY ?? "", baseUrl: "https://heyqr.app" });

const current = await heyqr.getDestination("Q8d3…");
try {
  await heyqr.updateDestination("Q8d3…", { destination: "https://littlefern.cafe/today", revision: current.revision });
} catch (error) {
  // Someone changed it first: read it again and decide whether your change still applies.
  if (isRevisionConflict(error)) console.warn("Changed elsewhere: read it again and reapply if it still applies.");
  else throw error;
}`;
