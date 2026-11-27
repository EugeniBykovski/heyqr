import "server-only";
import { CatalogError } from "../billing/checkout";
import { reportFailure } from "../monitoring";

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
        | "processing"
        // HEY-199: Undo came after the restore window; the codes stay deleted.
        | "expired";
      /** HEY-119: the field the error belongs to, and why (a destination: empty, spaces or invalid). */
      field?: "destination";
      problem?: "empty" | "spaces" | "invalid";
    };

/** Error name and database error code only; no message text, query or parameters. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? `${error.name} (database code ${cause.code})` : error.name;
}

/**
 * `E`: an action-specific result besides ActionResult (e.g. HEY-128's destination conflict).
 * HEY-175: `operation` names the step for monitoring (e.g. "checkout.create"); billing operations alert as critical.
 * Expected refusals (unauthorized, an offer not for sale) aren't failures and aren't reported.
 */
export async function guard<T, E = never>(fn: () => Promise<ActionResult<T> | E>, operation?: string): Promise<ActionResult<T> | E> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === "UnauthorizedError") return { ok: false, error: "unauthorized" };
    // Design 4.8: an offer this currency can't charge as shown (no Stripe Price, or its amount differs).
    if (error instanceof CatalogError) {
      // HEY-175: not for sale in this currency is an answer; a Stripe Price that differs from the published one blocks
      // every sale of that offer.
      if (error.code === "price_mismatch")
        reportFailure(error, { operation: operation ?? "checkout.create", severity: "critical", tags: { reason: error.code } });
      return { ok: false, error: error.code };
    }
    // Never log the error itself: a failed query's message carries its parameters, which can include QR content
    // such as a Wi-Fi password. Log only what identifies the failure.
    console.error(`[action] failed: ${describeError(error)}`);
    reportFailure(error, {
      operation: operation ?? "server.action",
      severity: operation && /^(checkout|billing)\./.test(operation) ? "critical" : "low",
      log: operation !== undefined,
    });
    return { ok: false, error: "failed" };
  }
}
