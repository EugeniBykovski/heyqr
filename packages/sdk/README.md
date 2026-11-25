# @heyqr/sdk

The hosted HeyQR REST API, v1, for TypeScript. It has two parts:

- **Types** (HEY-160): the public contract of every request, response and error.
- **Client** (HEY-161): `HeyQrClient`, with `createQr`, `getLayout` and `getDestination`.

The update methods come with HEY-162, retries and idempotent creation with HEY-165, and npm publishing later. The HTTP
contract itself is [docs/API_V1.md](../../docs/API_V1.md).

This package is separate from [`@heyqr/qr-core`](../qr-core), the free local renderer: nothing here renders a code.
It depends on no other package and uses no platform module, only the runtime's `fetch` (Node 18+, Deno, Bun, workers).
Its declarations don't touch Next.js, the database or server modules.

```ts
import type { CreateQrRequest, Layout, UpdateLayoutRequest } from "@heyqr/sdk";
```

Import only from `@heyqr/sdk`; deep imports aren't part of the contract.

## Client

```ts
import { HeyQrClient, isHeyQrApiError } from "@heyqr/sdk";

const apiKey = process.env.HEYQR_API_KEY;
if (!apiKey) throw new Error("Set HEYQR_API_KEY");
const heyqr = new HeyQrClient({ apiKey, baseUrl: "https://heyqr.example" });
```

| Method                          | Request                                              | Returns                                                                               |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `createQr(request)`             | `POST /api/v1/qr-codes`                              | `CreateQrResponse`: the draft's `id`, `status` and its layouts' ids, in request order |
| `getLayout(qrCodeId, layoutId)` | `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}` | `Layout`, with its `LayoutRevision` (a string)                                        |
| `getDestination(qrCodeId)`      | `GET /api/v1/qr-codes/{qrCodeId}/destination`        | `Destination`, with its `DestinationRevision` (a number)                              |

**Options:**

- `apiKey` (required): an `hqk_…` key from Account → API keys.
- `baseUrl` (required): HeyQR's origin, without `/api/v1`. It's `http://localhost:3000` locally.
- `fetch` (optional): defaults to the global one.

**Server only.** The constructor refuses to run where `document` exists, because an API key must never reach a
browser.

**The key.** It's sent only as `Authorization: Bearer <key>`. It never goes in a URL, an error message, a log, or the
client's JSON or `inspect` output. IDs are URL-encoded into the path.

**Errors.**

- **`HeyQrApiError`:** the API answered with an error. It has `status` (the HTTP status), `code` (the API error code)
  and `response` (the documented `{ status, body }`).
  - The per-method types are `CreateQrError`, `GetLayoutError` and `GetDestinationError`.
  - Their `response` narrows by status and code, e.g. to `invalid_request` with its `details`.
- **`HeyQrError`:** no documented answer arrived (a network failure, or a non-JSON body). It has `status` when a
  response arrived.

There are no automatic retries yet (HEY-165).

```ts
try {
  const created = await heyqr.createQr(request);
} catch (error) {
  if (isHeyQrApiError(error)) console.error(error.status, error.code); // e.g. 401 unauthorized, 422 invalid_request
}
```

### Runnable example: create and read

[`examples/create-and-read.ts`](examples/create-and-read.ts) does three things:

1. creates a Dynamic QR with the layout in [`examples/sticker-layout.json`](examples/sticker-layout.json);
2. reads that layout;
3. fetches the destination.

It prints the IDs and both revisions:

```sh
HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
HEYQR_BASE_URL=http://localhost:3000 \
pnpm exec tsx packages/sdk/examples/create-and-read.ts
```

```json
{
  "created": { "id": "8iQl…", "status": "draft", "layoutIds": ["086Q…"] },
  "layout": { "id": "086Q…", "qrCodeId": "8iQl…", "name": "Sticker", "revision": "1795599789219452" },
  "destination": {
    "qrCodeId": "8iQl…",
    "destination": "https://littlefern.cafe/today",
    "revision": 0,
    "previousDestination": null,
    "shortLink": null
  }
}
```

## Exports

| Area                                                         | Types                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client (HEY-161)                                             | `HeyQrClient`, `HeyQrApiError`, `HeyQrError`, `isHeyQrApiError`, `HeyQrClientOptions`, `FetchLike`, `CreateQrError`, `GetLayoutError`, `GetDestinationError`                                                                                                             |
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

- `pnpm exec vitest run packages/sdk`: the client's request path, errors (401, 404, 422 validation, `not_dynamic`,
  non-JSON, network) and where the key may not appear, against a stubbed `fetch`.
- `packages/sdk/test/live.test.ts` runs against a running API when `HEYQR_API_KEY` and `HEYQR_BASE_URL` are set
  (optionally `HEYQR_REVOKED_API_KEY`). Otherwise it's skipped.
- `pnpm --filter @heyqr/sdk typecheck` (also part of `pnpm typecheck`): the package and the examples compile, the package under its own config (no DOM, no Node
  types, `exactOptionalPropertyTypes`), and so does the clean consumer in `test/consumer`. The consumer imports only
  `@heyqr/sdk`; its `@ts-expect-error` lines must fail to compile.
- `src/server/api/v1/sdk-contract.test.ts`: the SDK types against the route schemas and response types, and SDK-typed
  samples through the server's request validation.
- The response shapes of the real routes against SDK-typed samples: the PostgreSQL suite (`SDK contract: route
responses`) and the export route's tests.
