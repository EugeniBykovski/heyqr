import type {
  Destination,
  GetDestinationErrorResponse,
  UpdateDestinationErrorResponse,
  UpdateDestinationRequest,
  UpdateDestinationResponse,
} from "./destination.js";
import type { AnyApiErrorBody } from "./errors.js";
import type { GetLayoutErrorResponse, Layout, UpdateLayoutErrorResponse, UpdateLayoutRequest } from "./layouts.js";
import type { ApiResponse } from "./errors.js";
import type { ExportErrorResponse, ExportQuery, PaymentRequiredError } from "./export.js";
import type { CreateQrErrorResponse, CreateQrRequest, CreateQrResponse } from "./qr-codes.js";

/*
 * HEY-161 / QR-22.02: the HeyQR REST API v1 client: create a QR, read a layout, read a Dynamic code's destination.
 * HEY-162 / QR-22.03: update a layout and change a destination, each from the revision its read returned. A stale
 * revision throws HeyQrApiError 409 with the endpoint's conflict details; retrying is the caller's choice.
 * HEY-163 / QR-22.04: download a layout's PNG or SVG. The API answers 302 to a short-lived signed link (HeyQR's
 * private storage), fetched in a second request without Authorization or cookies, or 200 with the file (a local
 * server without storage). 402 payment_required comes back as HeyQrApiError with its paymentUrl; nothing is retried.
 * One request path for every method: the configured base URL + /api/v1, `Authorization: Bearer <key>` (the only place
 * the key goes: never the URL, a log or an error message), JSON in and out. A non-2xx answer throws HeyQrApiError with
 * the documented HTTP status and API error code. No retries (HEY-165). Server-side only: an API key must not reach a
 * browser. Depends on no package and no platform types: `fetch` is the runtime's (Node 18+), or the one given.
 * HEY-164 / QR-22.05: every call has a deadline (timeoutMs, default 30 s) covering the whole call: the request, the
 * response body, and for downloads the signed-file request and its body. It is enforced even when a custom fetch
 * ignores abort signals, and its timer is always cleared. A caller's AbortSignal cancels a call. Outcomes stay distinct:
 * HeyQrTimeoutError, HeyQrAbortError, a network HeyQrError, HeyQrRateLimitError (429, with Retry-After), and
 * HeyQrApiError for every documented API error (draft_limit, payment_required, revision_conflict, …). A call that timed
 * out may still have been applied by the server; nothing is retried here.
 * HEY-165 / QR-22.06: createQr takes an idempotencyKey (sent as Idempotency-Key). Retrying with the same key and the
 * same request, after a timeout or a lost response, returns the original code instead of creating another; reusing the
 * key for a different request is 409 idempotency_key_reused. When to retry stays with the caller.
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

type FetchResponse = Awaited<ReturnType<FetchLike>>;

export type HeyQrClientOptions = {
  /** An account API key (`hqk_…`), created under Account → API keys. Keep it on the server. */
  apiKey: string;
  /** HeyQR's origin, e.g. `https://heyqr.example` (no `/api/v1`). For local development, `http://localhost:3000`. */
  baseUrl: string;
  /** A Fetch implementation; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** The deadline for one call in milliseconds, through the whole response (default DEFAULT_TIMEOUT_MS, 30 s). */
  timeoutMs?: number;
};

/** An error response the client received: `{ status, body }` as the API documents it. */
type ErrorResponse = { status: number; body: AnyApiErrorBody };

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
  | "invalid_options"; // the client or call options are invalid

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
      `The HeyQR API is rate limiting this key (429${retryAfterSeconds === null ? "" : `; retry after ${retryAfterSeconds} s`}).`,
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

const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;

/** Whether the call ended because of a timeout (HeyQrTimeoutError). */
export const isTimeout = (value: unknown): value is HeyQrTimeoutError => value instanceof HeyQrTimeoutError;

const KEY = /^hqk_[A-Za-z0-9_-]+$/;

export class HeyQrClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  /** The API root the client calls: `<baseUrl>/api/v1`. */
  readonly apiUrl: string;

  constructor(options: HeyQrClientOptions) {
    if (typeof (globalThis as { document?: unknown }).document !== "undefined")
      throw new HeyQrError("HeyQrClient runs on a server only: an API key must never be sent to a browser.");
    if (typeof options.apiKey !== "string" || !KEY.test(options.apiKey)) throw new HeyQrError("apiKey must be a HeyQR API key (hqk_…).");
    if (!/^https?:\/\/[^/?#\s]+(\/[^?#\s]*)?$/.test(options.baseUrl ?? ""))
      throw new HeyQrError("baseUrl must be an http(s) origin such as https://heyqr.example (without /api/v1).");
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) throw new HeyQrError("No fetch available: pass options.fetch (Node 18+ has a global fetch).");
    this.#timeoutMs = checkTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.#apiKey = options.apiKey;
    this.#fetch = fetchImpl;
    this.apiUrl = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;
  }

  /**
   * `POST /api/v1/qr-codes`: creates a draft QR with its layouts for the key's account.
   * @returns the new code's id and its layouts' ids, in request order.
   * With `options.idempotencyKey`, a retry with the same key and request returns the same code (see CreateQrOptions).
   * @throws {CreateQrError} 400 malformed_json · 401 unauthorized · 403 draft_limit · 409 idempotency_key_reused ·
   *   422 invalid_request | content_too_long · 500 internal_error
   */
  createQr(request: CreateQrRequest, options?: CreateQrOptions): Promise<CreateQrResponse> {
    const key = options?.idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)))
      return Promise.reject(
        new HeyQrError("idempotencyKey must be 1–255 visible ASCII characters (use newIdempotencyKey()).", undefined, "invalid_options"),
      );
    return this.#request<CreateQrResponse, CreateQrErrorResponse>(
      "POST",
      "/qr-codes",
      request,
      options,
      key === undefined ? {} : { "idempotency-key": key },
    );
  }

  /**
   * `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}`: one saved layout with its LayoutRevision (a string).
   * @throws {GetLayoutError} 401 unauthorized · 404 not_found · 500 internal_error
   */
  getLayout(qrCodeId: string, layoutId: string, options?: RequestOptions): Promise<Layout> {
    return this.#request<Layout, GetLayoutErrorResponse>(
      "GET",
      `/qr-codes/${segment(qrCodeId)}/layouts/${segment(layoutId)}`,
      undefined,
      options,
    );
  }

  /**
   * `GET /api/v1/qr-codes/{qrCodeId}/destination`: a Dynamic code's destination with its DestinationRevision (a number).
   * @throws {GetDestinationError} 401 unauthorized · 404 not_found · 422 not_dynamic · 500 internal_error
   */
  getDestination(qrCodeId: string, options?: RequestOptions): Promise<Destination> {
    return this.#request<Destination, GetDestinationErrorResponse>("GET", `/qr-codes/${segment(qrCodeId)}/destination`, undefined, options);
  }

  /**
   * `PATCH /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}`: changes only that layout, from the LayoutRevision
   * getLayout (or the last update) returned. Sends `revision` and the given `name`, `layout` and `editor` only.
   * @returns the updated layout, with its new revision.
   * @throws {UpdateLayoutError} 400 malformed_json · 401 unauthorized · 404 not_found · 409 revision_conflict (the
   *   layout was saved since: reload it and decide) · 422 invalid_request | content_too_long · 500 internal_error
   */
  updateLayout(qrCodeId: string, layoutId: string, request: UpdateLayoutRequest, options?: RequestOptions): Promise<Layout> {
    const body: Record<string, unknown> = { revision: request.revision };
    if (request.name !== undefined) body.name = request.name;
    if (request.layout !== undefined) body.layout = request.layout;
    if (request.editor !== undefined) body.editor = request.editor;
    return this.#request<Layout, UpdateLayoutErrorResponse>(
      "PATCH",
      `/qr-codes/${segment(qrCodeId)}/layouts/${segment(layoutId)}`,
      body,
      options,
    );
  }

  /**
   * `PATCH /api/v1/qr-codes/{qrCodeId}/destination`: changes a Dynamic code's destination from the DestinationRevision
   * getDestination (or the last change) returned. Sends `destination` and `revision` only.
   * @returns the destination now stored; `changed: false` when that address was already stored (nothing written).
   * @throws {UpdateDestinationError} 400 malformed_json · 401 unauthorized · 404 not_found · 409 revision_conflict
   *   (`response.body.error.current` is the destination and revision stored now) · 422 invalid_request | not_dynamic ·
   *   500 internal_error
   */
  updateDestination(qrCodeId: string, request: UpdateDestinationRequest, options?: RequestOptions): Promise<UpdateDestinationResponse> {
    const body = { destination: request.destination, revision: request.revision };
    return this.#request<UpdateDestinationResponse, UpdateDestinationErrorResponse>(
      "PATCH",
      `/qr-codes/${segment(qrCodeId)}/destination`,
      body,
      options,
    );
  }

  /**
   * `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}/export`: the layout's PNG or SVG, for a code that is paid for
   * (Static) or live (Dynamic). Options are the API's: `format`, `dpi` (PNG of a print layout), `scale` (PNG of a
   * screen layout), `transparent` (`"1"`). Every call is authorized again by HeyQR; downloading again never charges.
   * @returns the file's bytes, content type and suggested file name.
   * @throws {DownloadExportError} 401 unauthorized · 402 payment_required (`response.body.error.paymentUrl`: HeyQR's
   *   Export screen for this code, layout and format; open it as the owner, then call again) · 404 not_found ·
   *   422 invalid_request | too_long | too_large | scan_check_failed · 500 internal_error
   * @throws {HeyQrError} the signed download link failed or expired (call again for a new one)
   */
  async downloadExport(
    qrCodeId: string,
    layoutId: string,
    request: DownloadExportRequest,
    options?: RequestOptions,
  ): Promise<ExportedFile> {
    const query = [`format=${encodeURIComponent(request.format)}`];
    if (request.dpi !== undefined) query.push(`dpi=${encodeURIComponent(String(request.dpi))}`);
    if (request.scale !== undefined) query.push(`scale=${encodeURIComponent(String(request.scale))}`);
    if (request.transparent !== undefined) query.push(`transparent=${encodeURIComponent(request.transparent)}`);
    const path = `/qr-codes/${segment(qrCodeId)}/layouts/${segment(layoutId)}/export?${query.join("&")}`;
    return this.#withDeadline(options, async (deadline) => {
      const response = await this.#send("GET", path, undefined, deadline, "*/*");
      if (response.status === 302 || response.status === 303 || response.status === 307) {
        const location = response.headers.get("location");
        if (!location || !/^https?:\/\//.test(location))
          throw new HeyQrError("The HeyQR API redirected without a download link.", response.status, "invalid_response");
        // The signed link is a bearer link to one file: no Authorization, no cookies, nothing else. Same deadline.
        const file = await this.#transport(
          () => this.#fetch(location, { method: "GET", headers: {}, redirect: "follow", credentials: "omit", ...signalOf(deadline) }),
          deadline,
          "Downloading the file failed",
        );
        // The link's own address is never put in an error (it grants access until it expires).
        if (file.status !== 200)
          throw new HeyQrError(
            `The download link answered ${file.status}; request the export again for a new link.`,
            file.status,
            "download_failed",
          );
        return exported(request.format, file, "signed-link", deadline);
      }
      if (response.status === 200 && !isJson(response)) return exported(request.format, response, "direct", deadline);
      return this.#fail<ExportErrorResponse>(response, deadline);
    });
  }

  /** Runs one call under its deadline (and the caller's signal); the timer and listener are always cleaned up. */
  async #withDeadline<T>(options: RequestOptions | undefined, run: (deadline: Deadline) => Promise<T>): Promise<T> {
    const deadline = new Deadline(checkTimeout(options?.timeoutMs ?? this.#timeoutMs), options?.signal);
    try {
      return await deadline.race(run(deadline));
    } finally {
      deadline.dispose();
    }
  }

  /** One fetch under the deadline: a timeout or cancellation keeps its own error; anything else is a network error. */
  async #transport(start: () => Promise<FetchResponse>, deadline: Deadline, what: string): Promise<FetchResponse> {
    // Already timed out or cancelled (e.g. an aborted signal): nothing is sent.
    deadline.throwIfStopped();
    try {
      return await deadline.race(start());
    } catch (cause) {
      if (cause instanceof HeyQrError) throw cause;
      // The cause can carry the request (its headers, a signed URL); only its name goes into the error.
      throw new HeyQrError(`${what} (${cause instanceof Error ? cause.name : "network error"}).`, undefined, "network");
    }
  }

  /** Every API call's one request: the API URL, the Bearer key, no redirects followed. */
  #send(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: unknown,
    deadline: Deadline,
    accept = "application/json",
    extra: Record<string, string> = {},
  ): Promise<FetchResponse> {
    const headers: Record<string, string> = { ...extra, authorization: `Bearer ${this.#apiKey}`, accept };
    if (body !== undefined) headers["content-type"] = "application/json";
    return this.#transport(
      () =>
        this.#fetch(`${this.apiUrl}${path}`, {
          method,
          headers,
          redirect: "manual",
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...signalOf(deadline),
        }),
      deadline,
      "Request to the HeyQR API failed",
    );
  }

  /** A response that isn't the success the caller expected: rate limited, a documented API error, or a HeyQrError. */
  async #fail<E extends ErrorResponse>(response: FetchResponse, deadline: Deadline, text?: string): Promise<never> {
    const parsed = parseJson(text ?? (await readText(response, deadline)));
    if (response.status === 429)
      throw new HeyQrRateLimitError(retryAfter(response.headers.get("retry-after")), isErrorBody(parsed) ? parsed.error.code : null);
    if (isErrorBody(parsed)) throw new HeyQrApiError({ status: response.status, body: parsed } as E);
    throw new HeyQrError(
      `The HeyQR API answered ${response.status} without a JSON body it documents.`,
      response.status,
      "invalid_response",
    );
  }

  /** The JSON methods' request path. */
  #request<T, E extends ErrorResponse>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: unknown,
    options: RequestOptions | undefined,
    extra: Record<string, string> = {},
  ): Promise<T> {
    return this.#withDeadline(options, async (deadline) => {
      const response = await this.#send(method, path, body, deadline, "application/json", extra);
      const text = await readText(response, deadline);
      const parsed = parseJson(text);
      if (response.status >= 200 && response.status < 300 && parsed !== undefined) return parsed as T;
      return this.#fail<E>(response, deadline, text);
    });
  }

  /** Keeps the key out of logs and serialized objects. */
  toJSON() {
    return { apiUrl: this.apiUrl };
  }
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

const isJson = (response: FetchResponse) => /^application\/(problem\+)?json\b/i.test(response.headers.get("content-type") ?? "");

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

async function exported(
  format: "png" | "svg",
  response: FetchResponse,
  delivery: ExportedFile["delivery"],
  deadline: Deadline,
): Promise<ExportedFile> {
  let buffer: ArrayBuffer;
  try {
    buffer = await deadline.race(response.arrayBuffer());
  } catch (cause) {
    if (cause instanceof HeyQrError) throw cause;
    throw new HeyQrError(`Reading the file failed (${cause instanceof Error ? cause.name : "network error"}).`, response.status, "network");
  }
  return {
    format,
    contentType: response.headers.get("content-type") ?? (format === "png" ? "image/png" : "image/svg+xml"),
    filename: dispositionFilename(response.headers.get("content-disposition")),
    bytes: new Uint8Array(buffer),
    delivery,
  };
}

/** A response body as text, under the deadline (a stalled body times out like a stalled response). */
async function readText(response: FetchResponse, deadline: Deadline): Promise<string> {
  try {
    return await deadline.race(response.text());
  } catch (cause) {
    if (cause instanceof HeyQrError) throw cause;
    return "";
  }
}

/** Retry-After as seconds: a number of seconds, or an HTTP date (seconds from now, at least 0). */
export function retryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

const MAX_TIMER_MS = 2_147_483_647;
function checkTimeout(ms: number): number {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMER_MS)
    throw new HeyQrError(`timeoutMs must be a positive number of milliseconds up to ${MAX_TIMER_MS}.`, undefined, "invalid_options");
  return ms;
}

type Timers = { setTimeout(run: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
type AbortControllerLike = { readonly signal: AbortSignalLike; abort(reason?: unknown): void };
const timers = globalThis as unknown as Timers;

/**
 * One call's deadline: a timer and the caller's signal. When either fires, the in-flight fetch is aborted (when the
 * runtime supports it) and every raced step rejects at once with HeyQrTimeoutError or HeyQrAbortError, so a stalled
 * response, body or download ends on time even if a custom fetch ignores the signal.
 */
class Deadline {
  readonly signal: AbortSignalLike | undefined;
  #failure: HeyQrError | null = null;
  readonly #controller: AbortControllerLike | undefined;
  readonly #expired: Promise<never>;
  #reject: (error: HeyQrError) => void = () => undefined;
  readonly #timer: unknown;
  readonly #caller: AbortSignalLike | undefined;
  readonly #onAbort = () => this.#stop(new HeyQrAbortError());

  constructor(timeoutMs: number, caller: AbortSignalLike | undefined) {
    const Controller = (globalThis as { AbortController?: new () => AbortControllerLike }).AbortController;
    this.#controller = Controller ? new Controller() : undefined;
    this.signal = this.#controller?.signal;
    this.#expired = new Promise<never>((_, reject) => {
      this.#reject = reject;
    });
    this.#expired.catch(() => undefined);
    this.#timer = timers.setTimeout(() => this.#stop(new HeyQrTimeoutError(timeoutMs)), timeoutMs);
    this.#caller = caller;
    if (caller?.aborted) this.#stop(new HeyQrAbortError());
    else caller?.addEventListener("abort", this.#onAbort, { once: true });
  }

  #stop(error: HeyQrError) {
    if (this.#failure) return;
    this.#failure = error;
    this.#controller?.abort(error);
    this.#reject(error);
  }

  throwIfStopped() {
    if (this.#failure) throw this.#failure;
  }

  /** The step's result, or the deadline's error when it fires first. */
  race<T>(step: Promise<T>): Promise<T> {
    if (this.#failure) {
      step.catch(() => undefined);
      return Promise.reject(this.#failure);
    }
    return Promise.race([step, this.#expired]);
  }

  dispose() {
    timers.clearTimeout(this.#timer);
    this.#caller?.removeEventListener("abort", this.#onAbort);
  }
}

const signalOf = (deadline: Deadline) => (deadline.signal ? { signal: deadline.signal } : {});

/** A path segment, encoded (ids never change the path). */
const segment = (id: string) => encodeURIComponent(String(id));

function isErrorBody(value: unknown): value is AnyApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}
