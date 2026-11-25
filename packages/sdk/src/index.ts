/**
 * @heyqr/sdk: the hosted HeyQR REST API, v1 (docs/API_V1.md): its public TypeScript contract (HEY-160) and a client
 * (HEY-161: create a QR, read a layout, read a destination; HEY-162: update a layout, change a destination;
 * HEY-163: download a PNG or SVG export; HEY-164: timeouts, cancellation, rate limits, payment errors;
 * HEY-165: idempotent create retries). Every request sends `Authorization: Bearer <api key>`
 * to `<baseUrl>/api/v1`. Separate from @heyqr/qr-core (the free local renderer): nothing here renders a code.
 */
export { HeyQrClient } from "./client.js";
export {
  DEFAULT_TIMEOUT_MS,
  dispositionFilename,
  HeyQrAbortError,
  HeyQrApiError,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isHeyQrApiError,
  isIdempotencyConflict,
  isPaymentRequired,
  isRevisionConflict,
  isTimeout,
  newIdempotencyKey,
  retryAfter,
} from "./shared.js";
export type {
  AbortSignalLike,
  CreateQrError,
  CreateQrOptions,
  DownloadExportError,
  DownloadExportRequest,
  ExportedFile,
  FetchLike,
  GetDestinationError,
  GetLayoutError,
  HeyQrClientOptions,
  HeyQrErrorKind,
  RequestOptions,
  UpdateDestinationError,
  UpdateLayoutError,
} from "./shared.js";
export type { JsonObject, JsonValue } from "./json.js";
export type {
  AnyApiErrorBody,
  ApiErrorBody,
  ApiResponse,
  CommonErrorResponse,
  InternalError,
  InvalidRequestError,
  MalformedJsonError,
  NotFoundError,
  UnauthorizedError,
  ValidationProblem,
} from "./errors.js";
export type {
  ContentTooLongError,
  CreateQrErrorResponse,
  CreateQrLayout,
  CreateQrRequest,
  CreateQrResponse,
  CreateQrResult,
  DesignInput,
  DraftLimitError,
  IdempotencyKeyReusedError,
  LayoutDesign,
  LayoutEditorSettings,
  QrContent,
  QrContentType,
  QrMode,
  QrStatus,
} from "./qr-codes.js";
export type {
  GetLayoutErrorResponse,
  GetLayoutResult,
  Layout,
  LayoutRevision,
  LayoutRevisionConflictError,
  UpdateLayoutErrorResponse,
  UpdateLayoutRequest,
  UpdateLayoutResult,
} from "./layouts.js";
export type {
  Destination,
  DestinationRevision,
  DestinationRevisionConflictError,
  GetDestinationErrorResponse,
  GetDestinationResult,
  NotDynamicError,
  UpdateDestinationErrorResponse,
  UpdateDestinationRequest,
  UpdateDestinationResponse,
  UpdateDestinationResult,
} from "./destination.js";
export type {
  ExportErrorResponse,
  ExportFile,
  ExportFormat,
  ExportQuery,
  ExportRedirect,
  ExportResult,
  ExportTooLargeError,
  ExportTooLongError,
  PaymentRequiredError,
  ScanCheckFailedError,
  ScanIssue,
} from "./export.js";
