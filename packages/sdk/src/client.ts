import type { Destination, GetDestinationErrorResponse } from "./destination";
import type { AnyApiErrorBody } from "./errors";
import type { GetLayoutErrorResponse, Layout } from "./layouts";
import type { CreateQrErrorResponse, CreateQrRequest, CreateQrResponse } from "./qr-codes";

/*
 * HEY-161 / QR-22.02: the HeyQR REST API v1 client: create a QR, read a layout, read a Dynamic code's destination.
 * One request path for every method: the configured base URL + /api/v1, `Authorization: Bearer <key>` (the only place
 * the key goes: never the URL, a log or an error message), JSON in and out. A non-2xx answer throws HeyQrApiError with
 * the documented HTTP status and API error code. No retries (HEY-165). Server-side only: an API key must not reach a
 * browser. Depends on no package and no platform types: `fetch` is the runtime's (Node 18+), or the one given.
 */

/** The subset of the Fetch API the client uses (the global `fetch` of Node 18+, Deno, Bun or workers fits). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; redirect?: "manual" | "follow" | "error" },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

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

  /** Every method's one request path. */
  async #request<T, E extends ErrorResponse>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#apiKey}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.#fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        redirect: "manual",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // The cause can carry the request (and its headers); only its name goes into the error.
      throw new HeyQrError(`Request to the HeyQR API failed (${cause instanceof Error ? cause.name : "network error"}).`);
    }
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

/** A path segment, encoded (ids never change the path). */
const segment = (id: string) => encodeURIComponent(String(id));

function isErrorBody(value: unknown): value is AnyApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}
