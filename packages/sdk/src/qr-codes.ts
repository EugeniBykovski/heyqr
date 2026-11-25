import type { ApiErrorBody, ApiResponse, CommonErrorResponse, InvalidRequestError, MalformedJsonError } from "./errors";
import type { JsonObject } from "./json";

/** Static: the content is in the pattern. Dynamic: the pattern holds a short link whose destination can change. */
export type QrMode = "static" | "dynamic";

/** A saved code's state. API-created codes are drafts until activated in the app. */
export type QrStatus = "draft";

/** What a code holds, by `type`. Every object is strict: an unknown field is refused. */
export type QrContent =
  | { type: "website"; url: string }
  | { type: "text"; text: string }
  | { type: "wifi"; ssid: string; security: "WPA" | "WEP" | "nopass"; password?: string; hidden?: boolean }
  | {
      type: "contact";
      firstName?: string;
      lastName?: string;
      title?: string;
      company?: string;
      phone?: string;
      email?: string;
      website?: string;
    }
  | { type: "email"; to: string; subject?: string; body?: string }
  | { type: "phone"; number: string }
  | { type: "sms"; number: string; message?: string }
  | { type: "location"; name?: string; address: string }
  | { type: "event"; title: string; start: string; end?: string; place?: string };

export type QrContentType = QrContent["type"];

/**
 * A rendered layout: the versioned design record HeyQR's editor produces. The SDK passes it through as JSON; the
 * server checks it against the design contract.
 */
export type LayoutDesign = JsonObject;

/** Editor settings that reopen a layout in HeyQR's editor (optional). */
export type LayoutEditorSettings = JsonObject;

/**
 * What a request may send as `layout` or `editor`: any JSON object, such as a LayoutDesign from GET or one built with
 * HeyQR's editor helpers (their interface types aren't index-signature types, so requests take `object`).
 */
export type DesignInput = object;

/** One layout of a new code. */
export type CreateQrLayout = { name: string; layout: DesignInput; editor?: DesignInput };

/**
 * `POST /api/v1/qr-codes`. Create-only: there is no field for an owner, an existing code or layout id, a draft claim,
 * or billing and activation state. `destination` is for `"dynamic"` codes only (`"dynamic"` needs website content).
 */
export type CreateQrRequest = {
  /** 1–80 characters. */
  name: string;
  mode: QrMode;
  content: QrContent;
  destination?: string;
  /** 1–20 layouts, in order. */
  layouts: CreateQrLayout[];
};

/** 201: the new draft and its layouts' ids, in request order. */
export type CreateQrResponse = { id: string; status: QrStatus; layouts: { id: string }[] };

/** 403: the account already has the maximum number of drafts. */
export type DraftLimitError = ApiErrorBody<"draft_limit">;
/** 422: static content doesn't fit in a QR code with one of the layouts. */
export type ContentTooLongError = ApiErrorBody<"content_too_long">;

export type CreateQrErrorResponse =
  | CommonErrorResponse
  | ApiResponse<400, MalformedJsonError>
  | ApiResponse<403, DraftLimitError>
  | ApiResponse<422, InvalidRequestError | ContentTooLongError>;

export type CreateQrResult = ApiResponse<201, CreateQrResponse> | CreateQrErrorResponse;
