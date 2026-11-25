import type { ApiErrorBody, ApiResponse, CommonErrorResponse, InvalidRequestError, MalformedJsonError, NotFoundError } from "./errors.js";

/**
 * A Dynamic code's destination revision: a non-negative integer, +1 per real change. Not interchangeable with a
 * LayoutRevision (a string).
 */
export type DestinationRevision = number;

/** `GET /api/v1/qr-codes/{qrCodeId}/destination`. */
export type Destination = {
  qrCodeId: string;
  destination: string;
  revision: DestinationRevision;
  /** The address before the last change; null before the first one. */
  previousDestination: string | null;
  /** ISO 8601 time of the last change; null before the first one. */
  changedAt: string | null;
  /** The printed short link; null until the code is activated in the app. */
  shortLink: string | null;
};

/** `PATCH /api/v1/qr-codes/{qrCodeId}/destination`: from the revision GET returned. */
export type UpdateDestinationRequest = { destination: string; revision: DestinationRevision };

/** 200: the destination now stored. `changed: false` when the address was already stored (nothing written). */
export type UpdateDestinationResponse = Destination & { changed: boolean };

/** 409: the destination changed since that revision; nothing was saved. `current` is what's stored now. */
export type DestinationRevisionConflictError = ApiErrorBody<
  "revision_conflict",
  { current: { destination: string; revision: DestinationRevision } }
>;

/** 422: the owner's code is static and has no destination. */
export type NotDynamicError = ApiErrorBody<"not_dynamic">;

export type GetDestinationErrorResponse = CommonErrorResponse | ApiResponse<404, NotFoundError> | ApiResponse<422, NotDynamicError>;

export type UpdateDestinationErrorResponse =
  | CommonErrorResponse
  | ApiResponse<400, MalformedJsonError>
  | ApiResponse<404, NotFoundError>
  | ApiResponse<409, DestinationRevisionConflictError>
  | ApiResponse<422, InvalidRequestError | NotDynamicError>;

export type GetDestinationResult = ApiResponse<200, Destination> | GetDestinationErrorResponse;
export type UpdateDestinationResult = ApiResponse<200, UpdateDestinationResponse> | UpdateDestinationErrorResponse;
