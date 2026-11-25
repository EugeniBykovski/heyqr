import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createQrForOwner } from "@/server/api/v1/create-qr";
import { apiKeyOwner } from "@/server/api-keys/keys";
import { db } from "@/server/db";
import { logosFor } from "@/server/qr/logos-for";

/*
 * HEY-155 / QR-21.03: POST /api/v1/qr-codes creates a QR code (a draft) for the account of the API key in
 * `Authorization: Bearer <key>`. The owner comes only from the shared verifier (apiKeyOwner); a missing, malformed,
 * unknown, wrong or revoked key gets the same 401 before the body is read. Contract and errors: docs/API_V1.md.
 * Nothing here logs the key, the body or an error message (only the error's name).
 */
const NO_STORE = { "cache-control": "no-store" };

const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { ...NO_STORE, ...headers } });

const unauthorized = () =>
  error(
    401,
    "unauthorized",
    "A valid API key is required: Authorization: Bearer <key>.",
    {},
    { "www-authenticate": 'Bearer realm="heyqr"' },
  );

/** The bearer token of the request, or null. */
function bearer(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization")?.trim() ?? "");
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  try {
    const owner = await apiKeyOwner(db, bearer(request));
    if (!owner) return unauthorized();

    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return error(400, "malformed_json", "The request body must be a JSON object.");
    }

    const outcome = await createQrForOwner(db, owner, body, logosFor(owner));
    if (!outcome.ok) {
      if (outcome.error === "draft_limit")
        return error(403, "draft_limit", "This account has the maximum number of draft codes. Activate or delete one first.");
      if (outcome.error === "content_too_long")
        return error(422, "content_too_long", "The content doesn't fit in a QR code with this layout.");
      return error(422, "invalid_request", "The request isn't valid.", { details: outcome.details });
    }
    revalidatePath("/[locale]/dashboard", "page");
    return NextResponse.json(
      { id: outcome.qrCodeId, status: "draft", layouts: outcome.layoutIds.map((id) => ({ id })) },
      { status: 201, headers: NO_STORE },
    );
  } catch (cause) {
    console.error(`[api/v1/qr-codes] failed: ${cause instanceof Error ? cause.name : "unknown error"}`);
    return error(500, "internal_error", "Something went wrong. Nothing was created; try again.");
  }
}
