import { revalidatePath } from "next/cache";
import { apiError, apiJson, internalError, jsonBody, malformedJson, notFound, requestOwner, unauthorized } from "@/server/api/v1/http";
import { readLayoutForOwner, updateLayoutForOwner } from "@/server/api/v1/layouts";
import { db } from "@/server/db";
import { encodedValue } from "@/server/qr/export";
import { logosFor } from "@/server/qr/logos-for";
import { logoStore } from "@/server/storage/s3";

/*
 * HEY-156 / QR-21.04: one saved layout of a QR code, for the account of the API key (docs/API_V1.md).
 * GET returns its public design fields and current revision; PATCH updates it from that revision (409 if it changed).
 * 401 for any key that doesn't verify; the same 404 for a code or layout that isn't the key owner's, is deleted, or
 * doesn't belong together.
 */
type Ctx = RouteContext<"/api/v1/qr-codes/[qrCodeId]/layouts/[layoutId]">;
const ROUTE = "api/v1/qr-codes/layouts";

export async function GET(request: Request, ctx: Ctx) {
  try {
    const owner = await requestOwner(db, request);
    if (!owner) return unauthorized();
    const { qrCodeId, layoutId } = await ctx.params;
    const layout = await readLayoutForOwner(db, owner, qrCodeId, layoutId, logoStore());
    return layout ? apiJson(layout) : notFound();
  } catch (cause) {
    return internalError(ROUTE, cause);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const owner = await requestOwner(db, request);
    if (!owner) return unauthorized();
    const { qrCodeId, layoutId } = await ctx.params;
    const parsed = await jsonBody(request);
    if (!parsed.ok) return malformedJson();
    const outcome = await updateLayoutForOwner(db, owner, qrCodeId, layoutId, parsed.body, {
      encodedFor: encodedValue,
      prepare: logosFor(owner),
      store: logoStore(),
    });
    if (!outcome.ok) {
      if (outcome.error === "not_found") return notFound();
      if (outcome.error === "conflict")
        return apiError(409, "revision_conflict", "The layout changed since this revision. GET it again and reapply your change.");
      if (outcome.error === "content_too_long")
        return apiError(422, "content_too_long", "The code's content doesn't fit with this layout.");
      if (outcome.error === "invalid_request")
        return apiError(422, "invalid_request", "The request isn't valid.", { details: outcome.details });
      return internalError(ROUTE, new Error("unexpected outcome"));
    }
    revalidatePath("/[locale]/dashboard", "page");
    revalidatePath("/[locale]/dashboard/qr/[id]", "page");
    return apiJson(outcome.layout);
  } catch (cause) {
    return internalError(ROUTE, cause);
  }
}
