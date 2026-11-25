import { env } from "@/env";
import { authorizeApiExport } from "@/server/api/v1/export";
import { apiError, internalError, notFound, requestOwner, unauthorized } from "@/server/api/v1/http";
import { db } from "@/server/db";
import { deliverLayoutExport } from "@/server/qr/layout-export";
import { getLayoutWithQr } from "@/server/qr/repository";

/*
 * HEY-158 / QR-21.06: a layout's file for the account of the API key (docs/API_V1.md).
 * Order: the key (401), the options (422), the code and layout (404), the entitlement (402 with a payment URL), and
 * only then the private export flow (deliverLayoutExport: the same stored file and short-lived signed link as the
 * dashboard). Every request is checked again, including when the file is already stored. The 402 creates no charge or
 * Checkout Session; the payment URL and the download link never carry the key.
 */
type Ctx = RouteContext<"/api/v1/qr-codes/[qrCodeId]/layouts/[layoutId]/export">;
const ROUTE = "api/v1/qr-codes/layouts/export";
const RENDER_ERRORS: Record<string, string> = {
  too_long: "The code's content doesn't fit with this layout.",
  too_large: "This resolution is outside the export limits.",
  scan_check_failed: "The file didn't pass the scan check, so it wasn't delivered.",
};

export async function GET(request: Request, ctx: Ctx) {
  try {
    const owner = await requestOwner(db, request);
    if (!owner) return unauthorized();
    const { qrCodeId, layoutId } = await ctx.params;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const decision = await authorizeApiExport(db, owner, { qrCodeId, layoutId, query }, { appUrl: env.NEXT_PUBLIC_APP_URL });
    if (!decision.ok) {
      if (decision.error === "not_found") return notFound();
      if (decision.error === "invalid_request")
        return apiError(422, "invalid_request", "The request isn't valid.", { details: decision.details });
      const { paymentUrl, format, mode } = decision;
      return apiError(
        402,
        "payment_required",
        mode === "static"
          ? "This code's files need a one-time purchase. Open paymentUrl, signed in as the owner, to pay; then repeat this request."
          : "This Dynamic code's files need a live code: a plan, or the free trial's test code. Open paymentUrl to activate it; then repeat this request.",
        { paymentUrl, qrCodeId, layoutId, format },
      );
    }

    // The readable record (legacy designs upgraded, the owner's stored logos resolved), re-read for rendering.
    const record = await getLayoutWithQr(layoutId);
    if (!record || record.qrCode.id !== qrCodeId || record.qrCode.userId !== owner) return notFound();
    const res = await deliverLayoutExport(request, owner, record, decision.options);
    if (res.status < 400) return res;
    // A renderer refusal (`{ error, … }`), in the API's error shape.
    const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    const { error: code = "internal_error", ...extra } = body;
    return apiError(res.status, code, RENDER_ERRORS[code] ?? "The file couldn't be prepared.", extra);
  } catch (cause) {
    return internalError(ROUTE, cause);
  }
}
