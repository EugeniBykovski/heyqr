import { revalidatePath } from "next/cache";
import { createQrForOwner, IDEMPOTENCY_KEY } from "@/server/api/v1/create-qr";
import { apiError, apiJson, internalError, jsonBody, malformedJson, requestOwner, unauthorized } from "@/server/api/v1/http";
import { db } from "@/server/db";
import { logosFor } from "@/server/qr/logos-for";

/*
 * HEY-155 / QR-21.03: POST /api/v1/qr-codes creates a QR code (a draft) for the account of the API key in
 * `Authorization: Bearer <key>`. The owner comes only from the shared verifier (apiKeyOwner); a missing, malformed,
 * unknown, wrong or revoked key gets the same 401 before the body is read. Contract and errors: docs/API_V1.md.
 * Nothing here logs the key, the body or an error message (only the error's name).
 * HEY-165: an optional `Idempotency-Key` header makes retries safe: the same key and request replay the original 201
 * (marked `Idempotent-Replayed: true`); the same key with a different request is 409 idempotency_key_reused.
 */
export async function POST(request: Request) {
  try {
    const owner = await requestOwner(db, request);
    if (!owner) return unauthorized();
    const parsed = await jsonBody(request);
    if (!parsed.ok) return malformedJson();
    const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey))
      return apiError(422, "invalid_request", "The request isn't valid.", {
        details: [{ path: "Idempotency-Key", message: "1–255 visible ASCII characters (a UUID works)" }],
      });

    const outcome = await createQrForOwner(db, owner, parsed.body, logosFor(owner), idempotencyKey);
    if (!outcome.ok) {
      if (outcome.error === "draft_limit")
        return apiError(403, "draft_limit", "This account has the maximum number of draft codes. Activate or delete one first.");
      if (outcome.error === "idempotency_key_reused")
        return apiError(
          409,
          "idempotency_key_reused",
          "This Idempotency-Key was already used with a different request. Use a new key for a new code.",
        );
      if (outcome.error === "content_too_long")
        return apiError(422, "content_too_long", "The content doesn't fit in a QR code with this layout.");
      return apiError(422, "invalid_request", "The request isn't valid.", { details: outcome.details });
    }
    if (!outcome.replayed) revalidatePath("/[locale]/dashboard", "page");
    const res = apiJson({ id: outcome.qrCodeId, status: "draft", layouts: outcome.layoutIds.map((id) => ({ id })) }, 201);
    if (outcome.replayed) res.headers.set("idempotent-replayed", "true");
    return res;
  } catch (cause) {
    return internalError("api/v1/qr-codes", cause);
  }
}
