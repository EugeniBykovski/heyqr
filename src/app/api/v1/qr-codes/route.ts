import { revalidatePath } from "next/cache";
import { createQrForOwner } from "@/server/api/v1/create-qr";
import { apiError, apiJson, internalError, jsonBody, malformedJson, requestOwner, unauthorized } from "@/server/api/v1/http";
import { db } from "@/server/db";
import { logosFor } from "@/server/qr/logos-for";

/*
 * HEY-155 / QR-21.03: POST /api/v1/qr-codes creates a QR code (a draft) for the account of the API key in
 * `Authorization: Bearer <key>`. The owner comes only from the shared verifier (apiKeyOwner); a missing, malformed,
 * unknown, wrong or revoked key gets the same 401 before the body is read. Contract and errors: docs/API_V1.md.
 * Nothing here logs the key, the body or an error message (only the error's name).
 */
export async function POST(request: Request) {
  try {
    const owner = await requestOwner(db, request);
    if (!owner) return unauthorized();
    const parsed = await jsonBody(request);
    if (!parsed.ok) return malformedJson();

    const outcome = await createQrForOwner(db, owner, parsed.body, logosFor(owner));
    if (!outcome.ok) {
      if (outcome.error === "draft_limit")
        return apiError(403, "draft_limit", "This account has the maximum number of draft codes. Activate or delete one first.");
      if (outcome.error === "content_too_long")
        return apiError(422, "content_too_long", "The content doesn't fit in a QR code with this layout.");
      return apiError(422, "invalid_request", "The request isn't valid.", { details: outcome.details });
    }
    revalidatePath("/[locale]/dashboard", "page");
    return apiJson({ id: outcome.qrCodeId, status: "draft", layouts: outcome.layoutIds.map((id) => ({ id })) }, 201);
  } catch (cause) {
    return internalError("api/v1/qr-codes", cause);
  }
}
