import type { ApiErrorBody, ApiResponse, CommonErrorResponse, InvalidRequestError, NotFoundError } from "./errors";

export type ExportFormat = "png" | "svg" | "pdf";

/**
 * `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}/export` query. Strict: any other parameter is refused.
 * `dpi` applies to PNGs of print (mm) layouts (72–1200), `scale` to PNGs of screen (px) layouts (1–8).
 */
export type ExportQuery = { format: ExportFormat; dpi?: number; scale?: number; transparent?: "0" | "1" };

/**
 * Success with HeyQR's private storage (the hosted API): 302 to a short-lived signed link to the file. Follow it
 * without the `Authorization` header. The link expires; request the export again for a new one.
 */
export type ExportRedirect = { status: 302; headers: { location: string; "cache-control": "private, no-store" } };

/** Success without private storage (a local development server only): the file itself. */
export type ExportFile = {
  status: 200;
  headers: {
    "content-type": "image/png" | "image/svg+xml" | "application/pdf";
    "content-disposition": string;
    "cache-control": "private, no-store";
  };
};

/** 402: the owner's code isn't paid for (Static) or live (Dynamic). The API created no charge or Checkout. */
export type PaymentRequiredError = ApiErrorBody<
  "payment_required",
  {
    /** HeyQR's Export screen for the same code, layout and format; the owner signs in there and chooses to pay. */
    paymentUrl: string;
    qrCodeId: string;
    layoutId: string;
    format: ExportFormat;
  }
>;

/** 422: the content doesn't fit with this layout. */
export type ExportTooLongError = ApiErrorBody<"too_long", { bytes: number; maxBytes: number }>;
/** 422: the PNG size asked for is outside the export limits. */
export type ExportTooLargeError = ApiErrorBody<"too_large", { width: number; height: number }>;

/** Why a rendered file didn't pass the scan check. */
export type ScanIssue = { code: "invert" | "contrast" | "eyes" | "logo" | "text"; title: string; detail: string; fix: string };
/** 422: the file didn't pass the scan check, so it wasn't delivered (PDF: without `issues`). */
export type ScanCheckFailedError = ApiErrorBody<"scan_check_failed", { issues?: ScanIssue[] }>;

export type ExportErrorResponse =
  | CommonErrorResponse
  | ApiResponse<402, PaymentRequiredError>
  | ApiResponse<404, NotFoundError>
  | ApiResponse<422, InvalidRequestError | ExportTooLongError | ExportTooLargeError | ScanCheckFailedError>;

export type ExportResult = ExportRedirect | ExportFile | ExportErrorResponse;
