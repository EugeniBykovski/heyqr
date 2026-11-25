import type { GetDestinationErrorResponse, UpdateDestinationErrorResponse } from "./destination.js";
import type { AnyApiErrorBody, ApiResponse } from "./errors.js";
import type { ExportErrorResponse, ExportQuery, PaymentRequiredError } from "./export.js";
import type { GetLayoutErrorResponse, UpdateLayoutErrorResponse } from "./layouts.js";
import type { CreateQrErrorResponse } from "./qr-codes.js";

/*
 * HEY-168 / QR-23.02: what the server client and the browser entry share. Error classes, type guards, constants and
 * small helpers, with no transport, no authentication and no platform module. The browser build of "@heyqr/sdk"
 * (browser.ts) exports these, so code that handles errors compiles and runs on both sides. The client itself lives in
 * client.ts and is never part of a browser build.
 */

/** The parts of an AbortSignal the client uses (the runtime's AbortSignal fits). */
export type AbortSignalLike = {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
};

/** Per-call options for every client method. */
export type RequestOptions = {
  /** This call's deadline in milliseconds (default: the client's timeoutMs). */
  timeoutMs?: number;
  /** Cancels the call when aborted (throws HeyQrAbortError). */
  signal?: AbortSignalLike;
};

/** createQr's options: RequestOptions plus an Idempotency-Key (HEY-165). */
export type CreateQrOptions = RequestOptions & {
  /**
   * Makes retrying this create safe: keep the key (and the request) and send both again after a timeout or a lost
   * response; the API answers with the code it created the first time. 1–255 visible ASCII characters; use
   * newIdempotencyKey(). One key per intended code, for 24 hours.
   */
  idempotencyKey?: string;
};

/** The client's default deadline for one call (request, body and any signed download), in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** The subset of the Fetch API the client uses (the global `fetch` of Node 18+, Deno, Bun or workers fits). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect?: "manual" | "follow" | "error";
    credentials?: "omit";
    signal?: AbortSignalLike;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** @internal The response shape the client reads (not part of the public entry). */
export type FetchResponse = Awaited<ReturnType<FetchLike>>;

export type HeyQrClientOptions = {
  /** An account API key (`hqk_…`), created under Dashboard → API keys. Keep it on the server. */
  apiKey: string;
  /** HeyQR's origin, e.g. `https://heyqr.example` (no `/api/v1`). For local development, `http://localhost:3000`. */
  baseUrl: string;
  /** A Fetch implementation; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** The deadline for one call in milliseconds, through the whole response (default DEFAULT_TIMEOUT_MS, 30 s). */
  timeoutMs?: number;
};

/** An error response the client received: `{ status, body }` as the API documents it. */
/** @internal An error response as the API documents it: `{ status, body }`. */
export type ErrorResponse = { status: number; body: AnyApiErrorBody };

/**
 * The API answered with an error. `status` is the HTTP status and `code` the API's error code (branch on these;
 * `message` is for people). `response` is the documented `{ status, body }`, narrowed per method by its type parameter.
 * Never contains the API key.
 */
export class HeyQrApiError<R extends ErrorResponse = ErrorResponse> extends Error {
  override readonly name = "HeyQrApiError";
  readonly status: R["status"];
  readonly code: R["body"]["error"]["code"];
  readonly response: R;
  constructor(response: R) {
    super(`HeyQR API ${response.status} ${response.body.error.code}: ${response.body.error.message}`);
    this.status = response.status;
    this.code = response.body.error.code;
    this.response = response;
  }
}

/** Why a call ended without a documented API answer. */
export type HeyQrErrorKind =
  | "network" // the request or response failed in transit
  | "timeout" // the deadline passed (HeyQrTimeoutError)
  | "aborted" // the caller's signal cancelled it (HeyQrAbortError)
  | "rate_limited" // 429 (HeyQrRateLimitError)
  | "invalid_response" // an answer that isn't the API's documented JSON
  | "download_failed" // the signed download link didn't deliver the file
  | "invalid_options" // the client or call options are invalid
  | "server_only"; // HeyQrClient was used in a browser (HEY-168)

/** The call didn't produce a documented API response. `kind` says why; `status` is set when a response arrived. */
export class HeyQrError extends Error {
  override readonly name: string = "HeyQrError";
  readonly kind: HeyQrErrorKind;
  /** The HTTP status when a response arrived. */
  readonly status: number | undefined;
  constructor(message: string, status?: number, kind: HeyQrErrorKind = "invalid_response") {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

/**
 * The deadline passed before the call finished (request, body or signed download). The server may still have applied
 * a create or an update: read before retrying (an update retried with the same revision gets 409 if it was applied).
 */
export class HeyQrTimeoutError extends HeyQrError {
  override readonly name: string = "HeyQrTimeoutError";
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`The HeyQR API call timed out after ${timeoutMs} ms.`, undefined, "timeout");
    this.timeoutMs = timeoutMs;
  }
}

/** The caller's AbortSignal cancelled the call. As with a timeout, the server may already have applied it. */
export class HeyQrAbortError extends HeyQrError {
  override readonly name: string = "HeyQrAbortError";
  constructor() {
    super("The HeyQR API call was cancelled by the caller.", undefined, "aborted");
  }
}

/**
 * 429 Too Many Requests. `retryAfterSeconds` comes from Retry-After (seconds or an HTTP date) when present, whatever
 * the body; `code` is the API error code when the body is the API's JSON. When to retry is the caller's decision.
 */
export class HeyQrRateLimitError extends HeyQrError {
  override readonly name: string = "HeyQrRateLimitError";
  readonly retryAfterSeconds: number | null;
  readonly code: string | null;
  constructor(retryAfterSeconds: number | null, code: string | null) {
    super(
      `The HeyQR API is rate limiting this account (429${retryAfterSeconds === null ? "" : `; retry after ${retryAfterSeconds} s`}).`,
      429,
      "rate_limited",
    );
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = code;
  }
}

/** Errors each method throws. */
export type CreateQrError = HeyQrApiError<CreateQrErrorResponse>;
export type GetLayoutError = HeyQrApiError<GetLayoutErrorResponse>;
export type GetDestinationError = HeyQrApiError<GetDestinationErrorResponse>;
export type UpdateLayoutError = HeyQrApiError<UpdateLayoutErrorResponse>;
export type UpdateDestinationError = HeyQrApiError<UpdateDestinationErrorResponse>;
export type DownloadExportError = HeyQrApiError<ExportErrorResponse>;

/** What downloadExport fetches: a PNG or an SVG, with the API's own option names (ExportQuery). */
export type DownloadExportRequest = ExportQuery & { format: "png" | "svg" };

/** A downloaded file, ready to save (e.g. `await writeFile(file.filename ?? "qr.png", file.bytes)`). */
export type ExportedFile = {
  format: "png" | "svg";
  /** As delivered, e.g. `image/png` or `image/svg+xml`. */
  contentType: string;
  /** The file name HeyQR suggests (from Content-Disposition), or null when none was given. */
  filename: string | null;
  bytes: Uint8Array;
  /** How it arrived: a signed storage link (hosted HeyQR) or directly in the response (a local server). */
  delivery: "signed-link" | "direct";
};

/** A 409 revision conflict, from either update method (narrow `response` further for the destination's `current`). */
export const isRevisionConflict = (value: unknown): value is HeyQrApiError & { status: 409; code: "revision_conflict" } =>
  value instanceof HeyQrApiError && value.status === 409 && value.code === "revision_conflict";

export const isHeyQrApiError = (value: unknown): value is HeyQrApiError => value instanceof HeyQrApiError;

/** A 402 payment_required from downloadExport, narrowed so `response.body.error.paymentUrl` is typed. */
export const isPaymentRequired = (
  value: unknown,
): value is HeyQrApiError<ApiResponse<402, PaymentRequiredError>> & { status: 402; code: "payment_required" } =>
  value instanceof HeyQrApiError && value.status === 402 && value.code === "payment_required";

/** A 409 idempotency_key_reused from createQr: the key was already used for a different request. */
export const isIdempotencyConflict = (value: unknown): value is HeyQrApiError & { status: 409; code: "idempotency_key_reused" } =>
  value instanceof HeyQrApiError && value.status === 409 && value.code === "idempotency_key_reused";

/** A new Idempotency-Key (a random UUID from the runtime's Web Crypto). */
export function newIdempotencyKey(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!crypto?.randomUUID)
    throw new HeyQrError("No crypto.randomUUID in this runtime: pass your own idempotencyKey.", undefined, "invalid_options");
  return crypto.randomUUID();
}

/** Whether the call ended because of a timeout (HeyQrTimeoutError). */
export const isTimeout = (value: unknown): value is HeyQrTimeoutError => value instanceof HeyQrTimeoutError;

/** The file name in a Content-Disposition header: the UTF-8 `filename*` when given, else `filename`. */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8.trim());
    } catch {
      /* fall back to the plain name */
    }
  }
  return /filename\s*=\s*"([^"]*)"/i.exec(header)?.[1] ?? /filename\s*=\s*([^;\s]+)/i.exec(header)?.[1] ?? null;
}

/** Retry-After as seconds: a number of seconds, or an HTTP date (seconds from now, at least 0). */
export function retryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}
