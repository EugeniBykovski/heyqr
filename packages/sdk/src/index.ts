/**
 * @heyqr/sdk: the public TypeScript contract of the hosted HeyQR REST API, v1 (docs/API_V1.md). Types only.
 * Authenticate every request with `Authorization: Bearer <api key>`; base path `/api/v1`.
 * Separate from @heyqr/qr-core (the free local renderer): nothing here renders a code.
 */
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
