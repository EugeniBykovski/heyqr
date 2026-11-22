import "server-only";
import { CatalogError } from "../billing/checkout";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "invalid"
        | "not_found"
        | "too_long"
        | "failed"
        | "not_offered"
        | "price_mismatch"
        | "no_allowance"
        | "no_credits"
        | "limit"
        | "last_layout"
        | "draft_limit"
        // HEY-85: the layout was saved elsewhere (another tab or device) since this editor opened it.
        | "conflict"
        // HEY-87: already unlocked (or the Print Pack already bought): nothing to pay, download again instead.
        | "owned"
        // HEY-88: this code's order already has a completed Checkout (payment being confirmed); no second charge.
        | "processing";
    };

/** Error name and database error code only; no message text, query or parameters. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? `${error.name} (database code ${cause.code})` : error.name;
}

export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === "UnauthorizedError") return { ok: false, error: "unauthorized" };
    // Design 4.8: an offer this currency can't charge as shown (no Stripe Price, or its amount differs).
    if (error instanceof CatalogError) return { ok: false, error: error.code };
    // Never log the error itself: a failed query's message carries its parameters, which can include QR content
    // such as a Wi-Fi password. Log only what identifies the failure.
    console.error(`[action] failed: ${describeError(error)}`);
    return { ok: false, error: "failed" };
  }
}
