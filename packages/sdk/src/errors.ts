import type { JsonValue } from "./json.js";

/**
 * Every API error has this body: `{ "error": { "code", "message", …extra } }`. `message` is for people; branch on
 * `code`. Responses are `Cache-Control: no-store`.
 */
export type ApiErrorBody<Code extends string, Extra extends object = Record<never, never>> = {
  error: { code: Code; message: string } & Extra;
};

/** One reason a request was refused: where (`content.url`, `layouts[0].id`, `format`, `(body)`…) and why. Never the value. */
export type ValidationProblem = { path: string; message: string };

/** 400: the body isn't JSON. */
export type MalformedJsonError = ApiErrorBody<"malformed_json">;

/**
 * 401 (with `WWW-Authenticate: Bearer realm="heyqr"`): the key is missing, malformed, unknown, wrong or revoked. One
 * answer for all of these, sent before the request body is read.
 */
export type UnauthorizedError = ApiErrorBody<"unauthorized">;

/** 404: the code (or layout) isn't the key owner's, is deleted, doesn't exist, or the pair doesn't belong together. */
export type NotFoundError = ApiErrorBody<"not_found">;

/** 422: the request breaks a rule. */
export type InvalidRequestError = ApiErrorBody<"invalid_request", { details: ValidationProblem[] }>;

/** 500: nothing was created or changed; the request can be retried. */
export type InternalError = ApiErrorBody<"internal_error">;

/** A response the SDK describes: the HTTP status with its JSON body. */
export type ApiResponse<Status extends number, Body> = { status: Status; body: Body };

/** Errors any authenticated route can answer. */
export type CommonErrorResponse = ApiResponse<401, UnauthorizedError> | ApiResponse<500, InternalError>;

/** Any error body the v1 API documents (for code that handles errors generically). */
export type AnyApiErrorBody = ApiErrorBody<string, { [key: string]: JsonValue }>;
