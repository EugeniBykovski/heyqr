import { reportFailure, requestIdOf } from "../../monitoring";
import { NextResponse } from "next/server";
import { apiKeyOwner } from "../../api-keys/keys";
import type * as schema from "../../db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { takeRequest, type Bucket } from "./rate-limit";

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

const failed = (headers: Record<string, string> = {}) =>
  apiError(500, "internal_error", "Something went wrong. Nothing was changed; try again.", {}, headers);

export const internalError = (route: string, cause: unknown) => {
  // Only the error's name: messages of failed queries carry their parameters (QR content, designs).
  console.error(`[${route}] failed: ${cause instanceof Error ? cause.name : "unknown error"}`);
  // HEY-175: the same 500 as before; the paid file route alerts higher than the other API calls.
  reportFailure(cause, {
    operation: `api.${route.replace(/^api\/v1\//, "").replace(/\//g, ".")}`,
    severity: /export/.test(route) ? "high" : "low",
    route: `/${route}`,
  });
  return failed();
};

/** The bearer token of the request, or null. */
export function bearer(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization")?.trim() ?? "");
  return match?.[1] ?? null;
}

/** HEY-178: over the account's budget. The caller did nothing yet; `retry-after` is when the window ends. */
const rateLimited = (bucket: Bucket, retryAfterSeconds: number) =>
  apiError(
    429,
    "rate_limited",
    bucket === "export" ? "Too many exports for this account. Try again later." : "Too many requests for this account. Try again later.",
    { limit: bucket },
    { "retry-after": String(retryAfterSeconds) },
  );

/**
 * Every /api/v1 handler starts here, before the body is read or anything is loaded, changed or rendered:
 * 1. the key (HEY-155): any key that doesn't verify is the same 401, and spends nothing of any account's budget;
 * 2. HEY-178: the verified account's budgets, shared by all its keys (429), plus `"export"` for rendering. If they can't
 *    be checked the answer is the API's 500, never an unmetered request, and the failure is reported (never the key).
 */
export async function authorizeRequest(
  db: NodePgDatabase<typeof schema>,
  request: Request,
  extra?: Exclude<Bucket, "api">,
): Promise<{ ok: true; owner: string } | { ok: false; response: NextResponse }> {
  const owner = await apiKeyOwner(db, bearer(request));
  if (!owner) return { ok: false, response: unauthorized() };
  try {
    for (const bucket of extra ? (["api", extra] as const) : (["api"] as const)) {
      const taken = await takeRequest(db, owner, bucket);
      if (!taken.ok) return { ok: false, response: rateLimited(bucket, taken.retryAfterSeconds) };
    }
  } catch (cause) {
    reportFailure(cause, { operation: "api.rate_limit", severity: "high", route: "/api/v1", correlationId: requestIdOf(request.headers) });
    return { ok: false, response: failed({ "retry-after": "5" }) };
  }
  return { ok: true, owner };
}

/** The parsed JSON body, or undefined when it isn't JSON. */
export async function jsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: JSON.parse(await request.text()) };
  } catch {
    return { ok: false };
  }
}
