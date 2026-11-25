# @heyqr/sdk

The public TypeScript contract of the hosted HeyQR REST API, v1 (HEY-160). It is types only: the HTTP client methods
and npm publishing come in follow-up tickets. The HTTP contract itself is [docs/API_V1.md](../../docs/API_V1.md).

This package is separate from [`@heyqr/qr-core`](../qr-core), the free local renderer: nothing here renders a code,
and it depends on no other package. Its declarations don't touch Next.js, the database or server modules.

```ts
import type { CreateQrRequest, Layout, UpdateLayoutRequest } from "@heyqr/sdk";
```

Import only from `@heyqr/sdk`; deep imports aren't part of the contract.

## Exports

| Area                                                         | Types                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create a QR (`POST /api/v1/qr-codes`)                        | `CreateQrRequest`, `CreateQrLayout`, `QrContent`, `QrContentType`, `QrMode`, `DesignInput`, `CreateQrResponse`, `QrStatus`, `DraftLimitError`, `ContentTooLongError`, `CreateQrErrorResponse`, `CreateQrResult`                                                          |
| A layout (`GET` / `PATCH …/layouts/{layoutId}`)              | `Layout`, `LayoutRevision`, `LayoutDesign`, `LayoutEditorSettings`, `UpdateLayoutRequest`, `LayoutRevisionConflictError`, `GetLayoutErrorResponse`, `GetLayoutResult`, `UpdateLayoutErrorResponse`, `UpdateLayoutResult`                                                 |
| A Dynamic code's destination (`GET` / `PATCH …/destination`) | `Destination`, `DestinationRevision`, `UpdateDestinationRequest`, `UpdateDestinationResponse`, `DestinationRevisionConflictError`, `NotDynamicError`, `GetDestinationErrorResponse`, `GetDestinationResult`, `UpdateDestinationErrorResponse`, `UpdateDestinationResult` |
| Export (`GET …/layouts/{layoutId}/export`)                   | `ExportQuery`, `ExportFormat`, `ExportRedirect`, `ExportFile`, `PaymentRequiredError`, `ExportTooLongError`, `ExportTooLargeError`, `ScanCheckFailedError`, `ScanIssue`, `ExportErrorResponse`, `ExportResult`                                                           |
| Errors (all routes)                                          | `ApiErrorBody`, `ApiResponse`, `CommonErrorResponse`, `UnauthorizedError`, `NotFoundError`, `MalformedJsonError`, `InvalidRequestError`, `ValidationProblem`, `InternalError`, `AnyApiErrorBody`                                                                         |
| JSON                                                         | `JsonValue`, `JsonObject`                                                                                                                                                                                                                                                |

The `…Result` types pair each HTTP status with its body (`{ status, body }`), so a `switch (result.status)` and then
`result.body.error.code` narrow to the exact error.

## The two revisions

| Revision              | Type               | Comes from             | Used by                             |
| --------------------- | ------------------ | ---------------------- | ----------------------------------- |
| `LayoutRevision`      | `string` (decimal) | `Layout.revision`      | `UpdateLayoutRequest.revision`      |
| `DestinationRevision` | `number` (integer) | `Destination.revision` | `UpdateDestinationRequest.revision` |

They aren't interchangeable, and the compiler refuses one where the other belongs. A stale layout revision gets
`LayoutRevisionConflictError` (409, no current state). A stale destination revision gets
`DestinationRevisionConflictError` (409, with `error.current: { destination, revision }`).

## Export results

On HeyQR (with private storage), success is `ExportRedirect`: a `302` whose `location` is a short-lived signed link to
the file. Follow it without the `Authorization` header. `ExportFile` (`200` with the file) only happens on a local
development server without storage. An owner's code that isn't paid for or live gets `PaymentRequiredError` (402)
with `paymentUrl`, HeyQR's Export screen for the same code, layout and format. The API itself never charges.

## Examples

```ts
import type { CreateQrRequest, CreateQrResult, Destination, Layout, UpdateDestinationRequest, UpdateLayoutRequest } from "@heyqr/sdk";

// Create a static QR (layouts come from HeyQR's editor; any JSON object is sent through and checked by the server).
const menu: CreateQrRequest = {
  name: "Menu",
  mode: "static",
  content: { type: "website", url: "littlefern.cafe/menu" },
  layouts: [{ name: "Sticker", layout: stickerLayout }],
};

function createdId(result: CreateQrResult): string | null {
  if (result.status === 201) return result.body.id;
  if (result.status === 422 && result.body.error.code === "invalid_request") console.warn(result.body.error.details);
  return null;
}

// Read a revision, then prepare an update from it.
const rename = (current: Layout): UpdateLayoutRequest => ({ revision: current.revision, name: "Sticker v2" });
const move = (current: Destination): UpdateDestinationRequest => ({ destination: "littlefern.cafe/today", revision: current.revision });
```

More, with compile-time checks for invalid input and error narrowing: [`test/consumer/examples.ts`](test/consumer/examples.ts).

## Checks

- `pnpm --filter @heyqr/sdk typecheck` (also part of `pnpm typecheck`): the package compiles under its own config (no DOM, no Node
  types, `exactOptionalPropertyTypes`), and so does the clean consumer in `test/consumer`. The consumer imports only
  `@heyqr/sdk`; its `@ts-expect-error` lines must fail to compile.
- `src/server/api/v1/sdk-contract.test.ts`: the SDK types against the route schemas and response types, and SDK-typed
  samples through the server's request validation.
- The response shapes of the real routes against SDK-typed samples: the PostgreSQL suite (`SDK contract: route
responses`) and the export route's tests.
