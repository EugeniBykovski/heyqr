import type {
  Destination,
  GetDestinationErrorResponse,
  UpdateDestinationErrorResponse,
  UpdateDestinationRequest,
  UpdateDestinationResponse,
} from "./destination";
import type { AnyApiErrorBody } from "./errors";
import type { GetLayoutErrorResponse, Layout, UpdateLayoutErrorResponse, UpdateLayoutRequest } from "./layouts";
import type { ExportErrorResponse, ExportQuery } from "./export";
import type { CreateQrErrorResponse, CreateQrRequest, CreateQrResponse } from "./qr-codes";

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
 */

/** The subset of the Fetch API the client uses (the global `fetch` of Node 18+, Deno, Bun or workers fits). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect?: "manual" | "follow" | "error";
    credentials?: "omit";
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

/** The request didn't produce a documented API response (network failure, or a body that isn't the API's JSON). */
export class HeyQrError extends Error {
  override readonly name = "HeyQrError";
  /** The HTTP status when a response arrived. */
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
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

const KEY = /^hqk_[A-Za-z0-9_-]+$/;

export class HeyQrClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  /** The API root the client calls: `<baseUrl>/api/v1`. */
  readonly apiUrl: string;

  constructor(options: HeyQrClientOptions) {
    if (typeof (globalThis as { document?: unknown }).document !== "undefined")
      throw new HeyQrError("HeyQrClient runs on a server only: an API key must never be sent to a browser.");
    if (typeof options.apiKey !== "string" || !KEY.test(options.apiKey)) throw new HeyQrError("apiKey must be a HeyQR API key (hqk_…).");
    if (!/^https?:\/\/[^/?#\s]+(\/[^?#\s]*)?$/.test(options.baseUrl ?? ""))
      throw new HeyQrError("baseUrl must be an http(s) origin such as https://heyqr.example (without /api/v1).");
    const fetchImpl = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) throw new HeyQrError("No fetch available: pass options.fetch (Node 18+ has a global fetch).");
    this.#apiKey = options.apiKey;
    this.#fetch = fetchImpl;
    this.apiUrl = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;
  }

  /**
   * `POST /api/v1/qr-codes`: creates a draft QR with its layouts for the key's account.
   * @returns the new code's id and its layouts' ids, in request order.
   * @throws {CreateQrError} 400 malformed_json · 401 unauthorized · 403 draft_limit · 422 invalid_request |
   *   content_too_long · 500 internal_error
   */
  createQr(request: CreateQrRequest): Promise<CreateQrResponse> {
    return this.#request<CreateQrResponse, CreateQrErrorResponse>("POST", "/qr-codes", request);
  }

  /**
   * `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}`: one saved layout with its LayoutRevision (a string).
   * @throws {GetLayoutError} 401 unauthorized · 404 not_found · 500 internal_error
   */
  getLayout(qrCodeId: string, layoutId: string): Promise<Layout> {
    return this.#request<Layout, GetLayoutErrorResponse>("GET", `/qr-codes/${segment(qrCodeId)}/layouts/${segment(layoutId)}`);
  }

  /**
   * `GET /api/v1/qr-codes/{qrCodeId}/destination`: a Dynamic code's destination with its DestinationRevision (a number).
   * @throws {GetDestinationError} 401 unauthorized · 404 not_found · 422 not_dynamic · 500 internal_error
   */
  getDestination(qrCodeId: string): Promise<Destination> {
    return this.#request<Destination, GetDestinationErrorResponse>("GET", `/qr-codes/${segment(qrCodeId)}/destination`);
  }

  /**
   * `PATCH /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}`: changes only that layout, from the LayoutRevision
   * getLayout (or the last update) returned. Sends `revision` and the given `name`, `layout` and `editor` only.
   * @returns the updated layout, with its new revision.
   * @throws {UpdateLayoutError} 400 malformed_json · 401 unauthorized · 404 not_found · 409 revision_conflict (the
   *   layout was saved since: reload it and decide) · 422 invalid_request | content_too_long · 500 internal_error
   */
  updateLayout(qrCodeId: string, layoutId: string, request: UpdateLayoutRequest): Promise<Layout> {
    const body: Record<string, unknown> = { revision: request.revision };
    if (request.name !== undefined) body.name = request.name;
    if (request.layout !== undefined) body.layout = request.layout;
    if (request.editor !== undefined) body.editor = request.editor;
    return this.#request<Layout, UpdateLayoutErrorResponse>("PATCH", `/qr-codes/${segment(qrCodeId)}/layouts/${segment(layoutId)}`, body);
  }

  /**
   * `PATCH /api/v1/qr-codes/{qrCodeId}/destination`: changes a Dynamic code's destination from the DestinationRevision
   * getDestination (or the last change) returned. Sends `destination` and `revision` only.
   * @returns the destination now stored; `changed: false` when that address was already stored (nothing written).
   * @throws {UpdateDestinationError} 400 malformed_json · 401 unauthorized · 404 not_found · 409 revision_conflict
   *   (`response.body.error.current` is the destination and revision stored now) · 422 invalid_request | not_dynamic ·
   *   500 internal_error
   */
  updateDestination(qrCodeId: string, request: UpdateDestinationRequest): Promise<UpdateDestinationResponse> {
    const body = { destination: request.destination, revision: request.revision };
    return this.#request<UpdateDestinationResponse, UpdateDestinationErrorResponse>(
      "PATCH",
      `/qr-codes/${segment(qrCodeId)}/destination`,
      body,
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
  async downloadExport(qrCodeId: string, layoutId: string, request: DownloadExportRequest): Promise<ExportedFile> {
    const query = [`format=${encodeURIComponent(request.format)}`];
    if (request.dpi !== undefined) query.push(`dpi=${encodeURIComponent(String(request.dpi))}`);
    if (request.scale !== undefined) query.push(`scale=${encodeURIComponent(String(request.scale))}`);
    if (request.transparent !== undefined) query.push(`transparent=${encodeURIComponent(request.transparent)}`);
    const path = `/qr-codes/${segment(qrCodeId)}/layouts/${segment(layoutId)}/export?${query.join("&")}`;
    const response = await this.#send("GET", path, undefined, "*/*");

    if (response.status === 302 || response.status === 303 || response.status === 307) {
      const location = response.headers.get("location");
      if (!location || !/^https?:\/\//.test(location))
        throw new HeyQrError("The HeyQR API redirected without a download link.", response.status);
      // The signed link is a bearer link to one file: no Authorization, no cookies, nothing else.
      let file: FetchResponse;
      try {
        file = await this.#fetch(location, { method: "GET", headers: {}, redirect: "follow", credentials: "omit" });
      } catch (cause) {
        throw new HeyQrError(`Downloading the file failed (${cause instanceof Error ? cause.name : "network error"}).`);
      }
      // The link's own address is never put in an error (it grants access until it expires).
      if (file.status !== 200)
        throw new HeyQrError(`The download link answered ${file.status}; request the export again for a new link.`, file.status);
      return exported(request.format, file, "signed-link");
    }
    if (response.status === 200 && !isJson(response)) return exported(request.format, response, "direct");
    return this.#fail<ExportErrorResponse>(response);
  }

  /** Every API call's one request: the API URL, the Bearer key, no redirects followed. */
  async #send(method: "GET" | "POST" | "PATCH", path: string, body: unknown, accept = "application/json"): Promise<FetchResponse> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#apiKey}`, accept };
    if (body !== undefined) headers["content-type"] = "application/json";
    try {
      return await this.#fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        redirect: "manual",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // The cause can carry the request (and its headers); only its name goes into the error.
      throw new HeyQrError(`Request to the HeyQR API failed (${cause instanceof Error ? cause.name : "network error"}).`);
    }
  }

  /** A response that isn't the success the caller expected: the documented API error, or a HeyQrError. */
  async #fail<E extends ErrorResponse>(response: FetchResponse): Promise<never> {
    const parsed = parseJson(await response.text().catch(() => ""));
    if (isErrorBody(parsed)) throw new HeyQrApiError({ status: response.status, body: parsed } as E);
    throw new HeyQrError(`The HeyQR API answered ${response.status} without a JSON body it documents.`, response.status);
  }

  /** The JSON methods' request path. */
  async #request<T, E extends ErrorResponse>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const response = await this.#send(method, path, body);
    const text = await response.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (response.status >= 200 && response.status < 300 && parsed !== undefined) return parsed as T;
    if (isErrorBody(parsed)) throw new HeyQrApiError({ status: response.status, body: parsed } as E);
    throw new HeyQrError(`The HeyQR API answered ${response.status} without a JSON body it documents.`, response.status);
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

async function exported(format: "png" | "svg", response: FetchResponse, delivery: ExportedFile["delivery"]): Promise<ExportedFile> {
  return {
    format,
    contentType: response.headers.get("content-type") ?? (format === "png" ? "image/png" : "image/svg+xml"),
    filename: dispositionFilename(response.headers.get("content-disposition")),
    bytes: new Uint8Array(await response.arrayBuffer()),
    delivery,
  };
}

/** A path segment, encoded (ids never change the path). */
const segment = (id: string) => encodeURIComponent(String(id));

function isErrorBody(value: unknown): value is AnyApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}
