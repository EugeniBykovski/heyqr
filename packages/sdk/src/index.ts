/**
 * @heyqr/sdk: the hosted HeyQR REST API, v1 (docs/API_V1.md): its public TypeScript contract (HEY-160) and a client
 * (HEY-161: create a QR, read a layout, read a destination; HEY-162: update a layout, change a destination;
 * HEY-163: download a PNG or SVG export; HEY-164: timeouts, cancellation, rate limits, payment errors). Every request sends `Authorization: Bearer <api key>`
 * to `<baseUrl>/api/v1`. Separate from @heyqr/qr-core (the free local renderer): nothing here renders a code.
 */
export {
  DEFAULT_TIMEOUT_MS,
  dispositionFilename,
  HeyQrAbortError,
  HeyQrApiError,
  HeyQrClient,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isHeyQrApiError,
  isPaymentRequired,
  isRevisionConflict,
  isTimeout,
  retryAfter,
} from "./client";
export type {
  AbortSignalLike,
  CreateQrError,
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
} from "./client";
export type { JsonObject, JsonValue } from "./json";
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
} from "./errors";
export type {
  ContentTooLongError,
  CreateQrErrorResponse,
  CreateQrLayout,
  CreateQrRequest,
  CreateQrResponse,
  CreateQrResult,
  DesignInput,
  DraftLimitError,
  LayoutDesign,
  LayoutEditorSettings,
  QrContent,
  QrContentType,
  QrMode,
  QrStatus,
} from "./qr-codes";
export type {
  GetLayoutErrorResponse,
  GetLayoutResult,
  Layout,
  LayoutRevision,
  LayoutRevisionConflictError,
  UpdateLayoutErrorResponse,
  UpdateLayoutRequest,
  UpdateLayoutResult,
} from "./layouts";
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
} from "./destination";
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
} from "./export";
