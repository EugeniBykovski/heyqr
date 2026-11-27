/*
 * HEY-166: the smoke test's consumer, compiled in a clean project that installed @simplex-packages/heyqr-sdk from its .tgz. It imports
 * only "@simplex-packages/heyqr-sdk". Without HEYQR_API_KEY it checks the package's runtime exports; with it (and HEYQR_BASE_URL) it
 * creates a Dynamic QR, reads its layout and destination, updates both from their revisions, and reads them back.
 */
import {
  DEFAULT_TIMEOUT_MS,
  HeyQrAbortError,
  HeyQrApiError,
  HeyQrClient,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isHeyQrApiError,
  isIdempotencyConflict,
  isPaymentRequired,
  isRevisionConflict,
  newIdempotencyKey,
  type CreateQrRequest,
  type DestinationRevision,
  type LayoutRevision,
} from "@simplex-packages/heyqr-sdk";
import { sticker } from "./layout.js";

const assert = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`Assertion failed: ${what}`);
};

// The runtime exports exist and behave (no API needed).
assert(DEFAULT_TIMEOUT_MS === 30_000, "DEFAULT_TIMEOUT_MS");
for (const E of [HeyQrError, HeyQrApiError, HeyQrTimeoutError, HeyQrAbortError, HeyQrRateLimitError])
  assert(typeof E === "function", E.name);
assert(new HeyQrTimeoutError(5) instanceof HeyQrError && new HeyQrTimeoutError(5).kind === "timeout", "error classes");
assert(/^[0-9a-f-]{36}$/.test(newIdempotencyKey()), "newIdempotencyKey");
console.log("  exports: ok (HeyQrClient, error classes, guards, newIdempotencyKey, DEFAULT_TIMEOUT_MS)");

const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL ?? "http://localhost:3000";
if (!apiKey) {
  console.log("  live API: skipped (set HEYQR_API_KEY and HEYQR_BASE_URL)");
} else {
  const heyqr = new HeyQrClient({ apiKey, baseUrl });
  const request: CreateQrRequest = {
    name: "SDK smoke test",
    mode: "dynamic",
    content: { type: "website", url: "littlefern.cafe" },
    destination: "littlefern.cafe/menu",
    layouts: [{ name: "Sticker", layout: sticker.layout, editor: sticker.editor }],
  };
  try {
    const created = await heyqr.createQr(request, { idempotencyKey: newIdempotencyKey() });
    const layoutId = created.layouts[0]?.id ?? "";
    const layout = await heyqr.getLayout(created.id, layoutId);
    const destination = await heyqr.getDestination(created.id);
    const layoutRevision: LayoutRevision = layout.revision;
    const destinationRevision: DestinationRevision = destination.revision;

    const recolored = { ...sticker.layout, colors: { ...sticker.layout.colors, fg: "#8C2F4B" } };
    const updatedLayout = await heyqr.updateLayout(created.id, layoutId, {
      revision: layoutRevision,
      name: "Sticker v2",
      layout: recolored,
    });
    const updatedDestination = await heyqr.updateDestination(created.id, {
      destination: "littlefern.cafe/today",
      revision: destinationRevision,
    });

    const layoutBack = await heyqr.getLayout(created.id, layoutId);
    const destinationBack = await heyqr.getDestination(created.id);
    const fg = (layoutBack.layout as { colors?: { fg?: string } }).colors?.fg;
    assert(layoutBack.name === "Sticker v2" && fg === "#8C2F4B", "layout update persisted");
    assert(layoutBack.revision === updatedLayout.revision && layoutBack.revision !== layoutRevision, "layout revision advanced");
    assert(
      destinationBack.destination === "https://littlefern.cafe/today" && destinationBack.revision === destinationRevision + 1,
      "destination update persisted",
    );
    assert(destinationBack.previousDestination === "https://littlefern.cafe/menu" && updatedDestination.changed, "destination history");
    // A stale revision is refused (the error types work from the installed package).
    const stale = await heyqr.updateLayout(created.id, layoutId, { revision: layoutRevision, name: "stale" }).catch((e: unknown) => e);
    assert(
      isRevisionConflict(stale) && isHeyQrApiError(stale) && !isPaymentRequired(stale) && !isIdempotencyConflict(stale),
      "stale revision → 409",
    );

    console.log(
      `  live API: ok\n${JSON.stringify(
        {
          created: { id: created.id, status: created.status, layouts: created.layouts.map((l) => l.id) },
          layout: {
            before: { name: layout.name, revision: layoutRevision },
            after: { name: layoutBack.name, fg, revision: layoutBack.revision },
          },
          destination: {
            before: { destination: destination.destination, revision: destinationRevision },
            after: {
              destination: destinationBack.destination,
              previous: destinationBack.previousDestination,
              revision: destinationBack.revision,
            },
          },
          staleUpdate: "409 revision_conflict",
        },
        null,
        2,
      )}`,
    );
  } catch (error) {
    console.error(isHeyQrApiError(error) ? `HeyQR API error ${error.status} ${error.code}` : error);
    process.exitCode = 1;
    throw error;
  }
}
