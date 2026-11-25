import { NextResponse } from "next/server";
import { apiKeyOwner } from "../../api-keys/keys";
import type * as schema from "../../db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/*
 * Public API v1 response conventions (HEY-155, shared by every /api/v1 route; docs/API_V1.md): JSON errors
 * `{ error: { code, message, details? } }`, never cached; one 401 for any key that doesn't verify.
 */
export const NO_STORE = { "cache-control": "no-store" };

export const apiError = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) => NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { ...NO_STORE, ...headers } });

export const apiJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export const unauthorized = () =>
  apiError(
    401,
    "unauthorized",
    "A valid API key is required: Authorization: Bearer <key>.",
    {},
    { "www-authenticate": 'Bearer realm="heyqr"' },
  );

export const notFound = () => apiError(404, "not_found", "No such QR code or layout for this API key.");

export const malformedJson = () => apiError(400, "malformed_json", "The request body must be a JSON object.");

export const internalError = (route: string, cause: unknown) => {
  // Only the error's name: messages of failed queries carry their parameters (QR content, designs).
  console.error(`[${route}] failed: ${cause instanceof Error ? cause.name : "unknown error"}`);
  return apiError(500, "internal_error", "Something went wrong. Nothing was changed; try again.");
};

/** The bearer token of the request, or null. */
export function bearer(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization")?.trim() ?? "");
  return match?.[1] ?? null;
}

/** The verified key's owner (the shared verifier), or null: the caller answers `unauthorized()`. */
export const requestOwner = (db: NodePgDatabase<typeof schema>, request: Request) => apiKeyOwner(db, bearer(request));

/** The parsed JSON body, or undefined when it isn't JSON. */
export async function jsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: JSON.parse(await request.text()) };
  } catch {
    return { ok: false };
  }
}
