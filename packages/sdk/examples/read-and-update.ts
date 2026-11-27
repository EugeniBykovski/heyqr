/*
 * HEY-162: read a layout and a Dynamic code's destination, then update each from the revision its read returned.
 *
 *   HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
 *   HEYQR_BASE_URL=http://localhost:3000 \
 *   HEYQR_QR_ID=<qr id> HEYQR_LAYOUT_ID=<layout id> \
 *   HEYQR_LAYOUT_NAME="Sticker v2" HEYQR_DESTINATION=littlefern.cafe/today \
 *   pnpm exec tsx packages/sdk/examples/read-and-update.ts
 *
 * A stale revision (someone saved in between) throws HeyQrApiError 409; this example reports it and stops. Whether to
 * reload and apply the change again is your decision. The SDK never retries on its own.
 */
import { HeyQrClient, isHeyQrApiError, isRevisionConflict, type UpdateDestinationError } from "@simplex-packages/heyqr-sdk";

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Set ${name}.`);
  return value;
};
const heyqr = new HeyQrClient({ apiKey: env("HEYQR_API_KEY"), baseUrl: env("HEYQR_BASE_URL", "http://localhost:3000") });
const qrCodeId = env("HEYQR_QR_ID");
const layoutId = env("HEYQR_LAYOUT_ID");

try {
  // 1. Read both: each has its own revision (a layout's is a string, a destination's a number).
  const layout = await heyqr.getLayout(qrCodeId, layoutId);
  const destination = await heyqr.getDestination(qrCodeId);

  // 2. Update the layout from its revision: only the fields you send change.
  const renamed = await heyqr.updateLayout(qrCodeId, layoutId, { revision: layout.revision, name: env("HEYQR_LAYOUT_NAME", "Sticker v2") });

  // 3. Change the destination from its revision. `changed: false` means that address was already stored.
  const moved = await heyqr.updateDestination(qrCodeId, { destination: env("HEYQR_DESTINATION"), revision: destination.revision });

  console.log(
    JSON.stringify(
      {
        layout: { name: renamed.name, revision: { before: layout.revision, after: renamed.revision } },
        destination: {
          destination: moved.destination,
          changed: moved.changed,
          revision: { before: destination.revision, after: moved.revision },
        },
        shortLink: moved.shortLink,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (isRevisionConflict(error)) {
    // The destination conflict says what's stored now; the layout conflict means: read the layout again.
    const r = (error as UpdateDestinationError).response;
    const current = r.status === 409 && "current" in r.body.error ? r.body.error.current : undefined;
    console.error(
      current
        ? `Changed elsewhere: now ${current.destination} at revision ${current.revision}.`
        : "The layout changed elsewhere: read it again.",
    );
  } else if (isHeyQrApiError(error)) console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
}
