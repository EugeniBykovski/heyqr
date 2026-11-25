import type { ApiErrorBody, ApiResponse, CommonErrorResponse, InvalidRequestError, MalformedJsonError, NotFoundError } from "./errors.js";
import type { ContentTooLongError, DesignInput, LayoutDesign, LayoutEditorSettings } from "./qr-codes.js";

/**
 * A layout's revision: a decimal string (e.g. `"1764061234567890"`). It belongs to one layout and changes on every save.
 * Not interchangeable with a DestinationRevision (a number).
 */
export type LayoutRevision = string;

/** `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}` (and the PATCH response). Stored logos come back as images. */
export type Layout = {
  id: string;
  qrCodeId: string;
  name: string;
  revision: LayoutRevision;
  layout: LayoutDesign;
  editor: LayoutEditorSettings | null;
};

/** At least one of `name`, `layout` and `editor`. */
type LayoutChanges =
  | { name: string; layout?: DesignInput; editor?: DesignInput }
  | { name?: string; layout: DesignInput; editor?: DesignInput }
  | { name?: string; layout?: DesignInput; editor: DesignInput };

/**
 * `PATCH /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}`: changes only that layout, from the revision GET returned.
 * Fields left out keep their stored value; send `layout` and `editor` together to keep them in step.
 */
export type UpdateLayoutRequest = { revision: LayoutRevision } & LayoutChanges;

/** 409: the layout was saved since that revision; nothing was saved. GET it again and reapply. */
export type LayoutRevisionConflictError = ApiErrorBody<"revision_conflict">;

export type GetLayoutErrorResponse = CommonErrorResponse | ApiResponse<404, NotFoundError>;

export type UpdateLayoutErrorResponse =
  | CommonErrorResponse
  | ApiResponse<400, MalformedJsonError>
  | ApiResponse<404, NotFoundError>
  | ApiResponse<409, LayoutRevisionConflictError>
  | ApiResponse<422, InvalidRequestError | ContentTooLongError>;

export type GetLayoutResult = ApiResponse<200, Layout> | GetLayoutErrorResponse;
export type UpdateLayoutResult = ApiResponse<200, Layout> | UpdateLayoutErrorResponse;
