import { revalidatePath } from "next/cache";
import { readDestinationForOwner, updateDestinationForOwner, type ShortLinkFor } from "@/server/api/v1/destination";
import { apiError, apiJson, authorizeRequest, internalError, jsonBody, malformedJson, notFound } from "@/server/api/v1/http";
import { db } from "@/server/db";
import { encodedValue } from "@/server/qr/export";

/*
 * HEY-157 / QR-21.05: a Dynamic code's destination, for the account of the API key (docs/API_V1.md).
 * GET returns the destination and its revision; PATCH changes it from that revision (409 with the current one if it
 * moved). 401 for any key that doesn't verify; the same 404 for another account's, deleted or missing code.
 */
type Ctx = RouteContext<"/api/v1/qr-codes/[qrCodeId]/destination">;
const ROUTE = "api/v1/qr-codes/destination";
/** The code's short link, as printed (only asked for once the code has one). */
const shortLinkFor: ShortLinkFor = (qr) => encodedValue({ model: "dynamic", content: qr.content, shortCode: qr.shortCode });
const notDynamic = () => apiError(422, "not_dynamic", "Only Dynamic codes have a destination.");

export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeRequest(db, request);
    if (!auth.ok) return auth.response;
    const { owner } = auth;
    const { qrCodeId } = await ctx.params;
    const read = await readDestinationForOwner(db, owner, qrCodeId, shortLinkFor);
    if (!read.ok) return read.error === "not_found" ? notFound() : notDynamic();
    return apiJson(read.destination);
  } catch (cause) {
    return internalError(ROUTE, cause);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeRequest(db, request);
    if (!auth.ok) return auth.response;
    const { owner } = auth;
    const { qrCodeId } = await ctx.params;
    const parsed = await jsonBody(request);
    if (!parsed.ok) return malformedJson();
    const outcome = await updateDestinationForOwner(db, owner, qrCodeId, parsed.body, shortLinkFor);
    if (outcome.ok) {
      if (outcome.changed) revalidatePath("/[locale]/dashboard/qr/[id]", "page");
      return apiJson({ ...outcome.destination, changed: outcome.changed });
    }
    switch (outcome.error) {
      case "not_found":
        return notFound();
      case "not_dynamic":
        return notDynamic();
      case "conflict":
        return apiError(409, "revision_conflict", "The destination changed since this revision. Nothing was saved.", {
          current: outcome.current,
        });
      case "invalid_request":
        return apiError(422, "invalid_request", "The request isn't valid.", { details: outcome.details });
    }
  } catch (cause) {
    return internalError(ROUTE, cause);
  }
}
