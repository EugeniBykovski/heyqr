/*
 * HEY-161: create a Dynamic QR, read its layout, and fetch its destination with @heyqr/sdk.
 *
 *   HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
 *   HEYQR_BASE_URL=http://localhost:3000 \
 *   pnpm exec tsx packages/sdk/examples/create-and-read.ts
 *
 * Run it on a server (never in a browser): the key is sent only in the Authorization header.
 */
import { readFileSync } from "node:fs";
import { HeyQrClient, isHeyQrApiError, type CreateQrRequest, type DestinationRevision, type LayoutRevision } from "@heyqr/sdk";

// A layout as HeyQR's editor produces it (any saved design works; the server checks it).
const sticker = JSON.parse(readFileSync(new URL("./sticker-layout.json", import.meta.url), "utf8")) as { layout: object; editor: object };

const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL ?? "http://localhost:3000";
if (!apiKey) throw new Error("Set HEYQR_API_KEY (Account → API keys).");

const heyqr = new HeyQrClient({ apiKey, baseUrl });

const request: CreateQrRequest = {
  name: "Today's specials",
  mode: "dynamic",
  content: { type: "website", url: "littlefern.cafe" },
  destination: "littlefern.cafe/today",
  layouts: [{ name: "Sticker", layout: sticker.layout, editor: sticker.editor }],
};

try {
  // 1. Create: the new draft's id and its layouts' ids, in request order.
  const created = await heyqr.createQr(request);
  const layoutId = created.layouts[0]?.id;
  if (!layoutId) throw new Error("The API returned no layout id.");

  // 2. Read the layout: its revision is a string (start a layout update from it).
  const layout = await heyqr.getLayout(created.id, layoutId);
  const layoutRevision: LayoutRevision = layout.revision;

  // 3. Read the destination: its revision is a number (start a destination update from it).
  const destination = await heyqr.getDestination(created.id);
  const destinationRevision: DestinationRevision = destination.revision;

  console.log(
    JSON.stringify(
      {
        created: { id: created.id, status: created.status, layoutIds: created.layouts.map((l) => l.id) },
        layout: { id: layout.id, qrCodeId: layout.qrCodeId, name: layout.name, revision: layoutRevision },
        destination: {
          qrCodeId: destination.qrCodeId,
          destination: destination.destination,
          revision: destinationRevision,
          previousDestination: destination.previousDestination,
          shortLink: destination.shortLink,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  // The documented status and API error code (never the key).
  if (isHeyQrApiError(error)) console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
}
