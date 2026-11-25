/**
 * @heyqr/sdk: the hosted HeyQR REST API, v1 (docs/API_V1.md): its public TypeScript contract (HEY-160) and a client
 * (HEY-161: create a QR, read a layout, read a destination). Every request sends `Authorization: Bearer <api key>`
 * to `<baseUrl>/api/v1`. Separate from @heyqr/qr-core (the free local renderer): nothing here renders a code.
 */
export { HeyQrApiError, HeyQrClient, HeyQrError, isHeyQrApiError } from "./client";
export type { CreateQrError, FetchLike, GetDestinationError, GetLayoutError, HeyQrClientOptions } from "./client";
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
