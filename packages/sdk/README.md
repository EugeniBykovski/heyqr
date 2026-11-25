# @heyqr/sdk

The hosted HeyQR REST API, v1, for TypeScript: an ESM package with JavaScript and declarations (HEY-166). It has two
parts:

- **Types** (HEY-160): the public contract of every request, response and error.
- **Client:** `HeyQrClient`, with:
  - `createQr`, `getLayout` and `getDestination` (HEY-161);
  - `updateLayout` and `updateDestination` (HEY-162);
  - `downloadExport` for PNG and SVG files (HEY-163);
  - timeouts, cancellation, rate limits and payment errors on every method (HEY-164);
  - idempotent `createQr` retries with an Idempotency-Key (HEY-165).
- **React preview** (HEY-167): `HeyQrPreview` from `@heyqr/sdk/react`, a local QR preview for your own UI.

npm publishing comes later. The HTTP
contract itself is [docs/API_V1.md](../../docs/API_V1.md).

This package is separate from [`@heyqr/qr-core`](../qr-core), the free local renderer: nothing here renders a code.
It depends on no other package and uses no platform module, only the runtime's `fetch` (Node 18+, Deno, Bun, workers).
Its declarations don't touch Next.js, the database or server modules.

```ts
import type { CreateQrRequest, Layout, UpdateLayoutRequest } from "@heyqr/sdk";
```

Import only from `@heyqr/sdk`; deep imports aren't part of the contract.

## Quickstart

Create a Dynamic QR draft from a Node.js server, then read back its layout and destination.

**1. Requirements.** Node.js **18 or later**, with npm, and a HeyQR account.

**2. Issue an API key.** Sign in to HeyQR, open **Dashboard → API keys** (the account menu, or `/dashboard/api-keys`)
and choose **Create API key**. Copy the key (`hqk_…`): it's shown only once. The key belongs to your account and is
a secret. Use it only on a server, never in browser code, and never commit it.

**3. Create a project and install the SDK.**

```sh
mkdir heyqr-quickstart && cd heyqr-quickstart
npm init -y && npm pkg set type=module
npm install -D typescript @types/node
```

Install the SDK:

- **Pre-release (now):** install the packed tarball. In the HeyQR monorepo, run
  `cd packages/sdk && pnpm pack --pack-destination /tmp`. Then, in your project:

  ```sh
  npm install /tmp/heyqr-sdk-0.1.0.tgz
  ```

- **After publication (not available yet):** install it from the npm registry.

  ```sh
  npm install @heyqr/sdk
  ```

**4. Configure the environment.** Put these in your server's environment (a secret manager, or a `.env` file that
isn't committed):

```sh
export HEYQR_API_KEY="hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX"
export HEYQR_BASE_URL="https://heyqr.example"   # HeyQR's origin; http://localhost:3000 for a local HeyQR
```

**5. Save `quickstart.ts`.** This is the same file as
[`examples/quickstart.ts`](examples/quickstart.ts):

```ts
/*
 * HeyQR SDK quickstart: create a Dynamic QR draft, then read its saved layout and destination.
 * Server-side only (Node.js 18 or later). HEYQR_API_KEY is a secret: keep it in your server's environment, never in
 * browser code or source control. This script never prints it.
 */
import { HeyQrClient, isHeyQrApiError } from "@heyqr/sdk";

const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL;
if (!apiKey || !baseUrl) {
  console.error("Set HEYQR_API_KEY and HEYQR_BASE_URL first (see the SDK README).");
  process.exit(1);
}

const heyqr = new HeyQrClient({ apiKey, baseUrl, timeoutMs: 15_000 });

// A plain 512 × 512 px QR layout: HeyQR's default design, as the editor saves it.
const layout = {
  preset: "qr",
  unit: "px",
  width: 512,
  height: 512,
  qrSize: 512,
  border: false,
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF", frame: "#0D0D12", caption: "#0D0D12" },
  style: { pattern: "rounded", eyeFrame: "rounded", eyeBall: "rounded", logo: null },
  caption: { text: "", font: "dm", fontFamily: "'HeyQR Onest', sans-serif", weight: 700, size: 40, align: "center", position: "after" },
};

try {
  // 1. Create a Dynamic QR draft: its short link will send people to `destination`.
  const created = await heyqr.createQr({
    name: "Quickstart menu",
    mode: "dynamic",
    content: { type: "website", url: "https://example.com" },
    destination: "https://example.com/menu",
    layouts: [{ name: "Default", layout }],
  });
  const layoutId = created.layouts[0]?.id;
  if (!layoutId) throw new Error("The API returned no layout id.");

  // 2. Read the saved layout (its revision is a string) and the destination (its revision is a number).
  const saved = await heyqr.getLayout(created.id, layoutId);
  const destination = await heyqr.getDestination(created.id);

  console.log(
    JSON.stringify(
      {
        qrCodeId: created.id,
        status: created.status,
        layoutIds: created.layouts.map((l) => l.id),
        layout: { id: saved.id, name: saved.name, revision: saved.revision },
        destination: { url: destination.destination, revision: destination.revision, shortLink: destination.shortLink },
      },
      null,
      2,
    ),
  );
  console.log("Open Dashboard → My QR codes to see the draft.");
} catch (error) {
  if (!isHeyQrApiError(error)) throw error;
  console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  process.exitCode = 1;
}
```

**6. Compile and run it with plain Node.js:**

```sh
npx tsc quickstart.ts --target es2022 --module nodenext --moduleResolution nodenext --strict --types node --outDir dist
node dist/quickstart.js
```

It prints the new code's ids and both revisions, and never the key:

```json
{
  "qrCodeId": "8iQlIBDtOy5b4mPGCDKxT",
  "status": "draft",
  "layoutIds": ["086QhjBHjhDalfvkRYr__"],
  "layout": { "id": "086QhjBHjhDalfvkRYr__", "name": "Default", "revision": "1795599789219452" },
  "destination": { "url": "https://example.com/menu", "revision": 0, "shortLink": null }
}
Open Dashboard → My QR codes to see the draft.
```

**What the output means:**

- **`shortLink`** is `null` until you activate the code in HeyQR. Downloading files is a separate step.
- **Revisions:** the layout's is a string and the destination's is a number. Each update starts from its own revision
  (see the update methods below).
- **The draft:** it appears in **Dashboard → My QR codes** as a Dynamic Website code named "Quickstart menu".

## Buy and download a Static code's files

Export a Static QR code's PNG and SVG from your server: the first export tells you the code needs its one-time
purchase, the owner pays in HeyQR, and the same export then returns the files, as often as you like.

**1. Before you start.** Follow the [Quickstart](#quickstart) steps 1–4 (project, SDK installed, `HEYQR_API_KEY` and
`HEYQR_BASE_URL` set). You need an unpaid **Static** code of the key's account and one of its layouts:

- **From HeyQR:** open the code from **Dashboard → My QR codes**. Its QR details address is
  `/dashboard/qr/<qrCodeId>`, and a layout's **Edit** link is `/edit/<qrCodeId>?layout=<layoutId>`.
- **From the API:** `createQr` with `mode: "static"`, then use `created.id` and `created.layouts[0].id`.

**2. Save `purchase-and-export.ts`.** This is the same file as
[`examples/purchase-and-export.ts`](examples/purchase-and-export.ts):

```ts
/*
 * HeyQR SDK: buy a Static QR code's files, then download (and re-download) its PNG and SVG.
 * Server-side only (Node.js 18 or later). HEYQR_API_KEY is a secret: keep it in your server's environment, never in
 * browser code or source control. This script never prints it, and the SDK never exposes the signed download links.
 *
 * 1. The first export of an unpaid Static code answers 402 payment_required with a paymentUrl: HeyQR's Export screen
 *    for this code, layout and format. The owner opens it, signed in, and completes Checkout. The API never charges.
 * 2. HeyQR unlocks the code when Stripe's webhook confirms the payment. Run this again with the same HEYQR_QR_ID and
 *    HEYQR_LAYOUT_ID (or set HEYQR_WAIT_SECONDS to keep retrying them): the PNG and SVG are saved to HEYQR_OUT_DIR.
 * 3. Then it exports both files again. Downloading again never creates an order, a charge or a credit deduction.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HeyQrClient, isHeyQrApiError, isPaymentRequired, type ExportedFile } from "@heyqr/sdk";

const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL;
const qrCodeId = process.env.HEYQR_QR_ID;
const layoutId = process.env.HEYQR_LAYOUT_ID;
if (!apiKey || !baseUrl || !qrCodeId || !layoutId) {
  console.error("Set HEYQR_API_KEY, HEYQR_BASE_URL, HEYQR_QR_ID and HEYQR_LAYOUT_ID first (see the SDK README).");
  process.exit(1);
}
const outDir = process.env.HEYQR_OUT_DIR ?? "exports";
const waitSeconds = Number(process.env.HEYQR_WAIT_SECONDS ?? "0");

const heyqr = new HeyQrClient({ apiKey, baseUrl, timeoutMs: 30_000 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (file: ExportedFile) => createHash("sha256").update(file.bytes).digest("hex");

/** Both files of this code and layout, always the same two ids. */
async function exportBoth(): Promise<ExportedFile[]> {
  const png = await heyqr.downloadExport(qrCodeId as string, layoutId as string, { format: "png", scale: 2 });
  const svg = await heyqr.downloadExport(qrCodeId as string, layoutId as string, { format: "svg" });
  return [png, svg];
}

try {
  // 1. Export, or learn that the code still needs its purchase.
  let files: ExportedFile[] | null = null;
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let shownPaymentUrl = false;
  while (!files) {
    try {
      files = await exportBoth();
    } catch (error) {
      if (!isPaymentRequired(error)) throw error;
      if (!shownPaymentUrl) {
        console.log("Payment required (402). Open this page in a browser, signed in as the code's owner, and complete Checkout:");
        console.log(`  ${error.response.body.error.paymentUrl}`);
        shownPaymentUrl = true;
      }
      if (Date.now() >= deadline) {
        console.log(
          "The code isn't unlocked yet. HeyQR unlocks it once Stripe confirms the payment (usually within seconds);",
          "run this again with the same HEYQR_QR_ID and HEYQR_LAYOUT_ID.",
        );
        process.exit(2);
      }
      // Waiting for the webhook: retry the same code and layout.
      await sleep(5_000);
    }
  }

  // 2. Save the PNG and the SVG under their suggested names.
  await mkdir(outDir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const path = join(outDir, file.filename ?? `qr-code.${file.format}`);
    await writeFile(path, file.bytes);
    saved.push({ path, format: file.format, contentType: file.contentType, bytes: file.bytes.byteLength, delivery: file.delivery });
  }
  console.log(JSON.stringify({ saved }, null, 2));

  // 3. Export again: the same files, with no new order, charge or credit.
  const again = await exportBoth();
  const reExport = again.map((file, i) => ({
    format: file.format,
    bytes: file.bytes.byteLength,
    sameAsFirst: sha256(file) === sha256(files[i] as ExportedFile),
  }));
  console.log(JSON.stringify({ reExport }, null, 2));
} catch (error) {
  if (!isHeyQrApiError(error)) throw error;
  console.error(`HeyQR API error ${error.status} ${error.code}: ${error.message}`);
  process.exitCode = 1;
}
```

**3. Compile it and run it with plain Node.js:**

```sh
npx tsc purchase-and-export.ts --target es2022 --module nodenext --moduleResolution nodenext --strict --types node --outDir dist
export HEYQR_QR_ID="<qr id>" HEYQR_LAYOUT_ID="<layout id>"
node dist/purchase-and-export.js
```

The code isn't paid yet, so the export answers `402 payment_required`. The script prints HeyQR's payment page for
this code and layout and exits with code 2:

```
Payment required (402). Open this page in a browser, signed in as the code's owner, and complete Checkout:
  https://heyqr.example/create/export?qr=<qr id>&layout=<layout id>&format=png&res=2
The code isn't unlocked yet. HeyQR unlocks it once Stripe confirms the payment (usually within seconds); run this again with the same HEYQR_QR_ID and HEYQR_LAYOUT_ID.
```

**4. Pay as the owner.** Open that address in a browser, signed in to HeyQR as the code's owner, choose
**Pay … and download** and complete Checkout. Nothing is charged until you do; the API itself never charges. HeyQR
unlocks the code when Stripe's webhook confirms the payment, usually within seconds.

**5. Run the same command again** (same `HEYQR_QR_ID` and `HEYQR_LAYOUT_ID`). The PNG and SVG are saved to `exports/`
(or `HEYQR_OUT_DIR`), then exported a second time to show they download again:

```json
{
  "saved": [
    { "path": "exports/sticker.png", "format": "png", "contentType": "image/png", "bytes": 92582, "delivery": "signed-link" },
    { "path": "exports/sticker.svg", "format": "svg", "contentType": "image/svg+xml", "bytes": 153278, "delivery": "signed-link" }
  ]
}
{
  "reExport": [
    { "format": "png", "bytes": 92582, "sameAsFirst": true },
    { "format": "svg", "bytes": 153278, "sameAsFirst": true }
  ]
}
```

- **Still `402`?** The payment isn't confirmed yet. Run it again in a moment with the same ids, or let it retry them:
  `HEYQR_WAIT_SECONDS=120 node dist/purchase-and-export.js` tries every 5 seconds for up to two minutes.
- **Downloading again** (this run's second export, or any later one, through the API or the dashboard) never creates
  an order, a charge or a credit deduction. The purchase covers every layout and format of the code.
- **What's printed:** file names, types and sizes. Never the API key or the signed download links (the SDK follows
  them itself and doesn't expose them).

## Entry points and runtimes (HEY-168)

| Import                                            | Contents                                                                             | Runs on                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `import { HeyQrClient, … } from "@heyqr/sdk"`     | the API client, every request, response and error type, the error classes and guards | **servers:** Node.js 18+, and Deno, Bun or workers with a global `fetch`. No React needed. |
| `import { HeyQrPreview } from "@heyqr/sdk/react"` | the React QR preview                                                                 | **browsers**, and React server rendering. Needs React 18+ (an optional peer dependency).   |

**The boundary is in the package itself:**

- **Separate entries:** `@heyqr/sdk/react` is its own bundle (React plus HeyQR's renderer). It never loads the API
  client, authentication code or any Node-only module.
- **`@heyqr/sdk` in a browser build:** a bundler (Vite, webpack, Next.js client components, …) resolves it to a browser
  build through the package's `browser` export condition.
  - That build has the same runtime exports (error classes, guards, constants), but no client: no transport, no
    authentication, no key handling.
  - Constructing `HeyQrClient` there throws `HeyQrError` with `kind: "server_only"` and a message pointing to your own
    server and to `@heyqr/sdk/react`.
  - Node.js always gets the real client. The real client also refuses to start where `document` exists.

### Quick start (Node.js)

See [Quickstart](#quickstart) at the top: a complete, self-contained server example.

## Client

```ts
import { HeyQrClient, isHeyQrApiError } from "@heyqr/sdk";

const apiKey = process.env.HEYQR_API_KEY;
if (!apiKey) throw new Error("Set HEYQR_API_KEY");
const heyqr = new HeyQrClient({ apiKey, baseUrl: "https://heyqr.example" });
```

| Method                                                                       | Request                                                                                      | Returns                                                                                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `createQr(request)`                                                          | `POST /api/v1/qr-codes`                                                                      | `CreateQrResponse`: the draft's `id`, `status` and its layouts' ids, in request order                                          |
| `getLayout(qrCodeId, layoutId)`                                              | `GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}`                                         | `Layout`, with its `LayoutRevision` (a string)                                                                                 |
| `getDestination(qrCodeId)`                                                   | `GET /api/v1/qr-codes/{qrCodeId}/destination`                                                | `Destination`, with its `DestinationRevision` (a number)                                                                       |
| `updateLayout(qrCodeId, layoutId, request)`                                  | `PATCH …/layouts/{layoutId}`: sends `revision` and the given `name`, `layout`, `editor` only | the updated `Layout`, with its new revision                                                                                    |
| `updateDestination(qrCodeId, request)`                                       | `PATCH …/destination`: sends `destination` and `revision` only                               | `UpdateDestinationResponse`: the stored destination, its revision, and `changed` (`false` when the address was already stored) |
| `downloadExport(qrCodeId, layoutId, { format, dpi?, scale?, transparent? })` | `GET …/layouts/{layoutId}/export` (PNG or SVG)                                               | `ExportedFile`: `bytes` (`Uint8Array`), `contentType`, `filename` (or null), `delivery`                                        |

**Options:**

- `apiKey` (required): an `hqk_…` key from Dashboard → API keys.
- `baseUrl` (required): HeyQR's origin, without `/api/v1`. It's `http://localhost:3000` locally.
- `fetch` (optional): defaults to the global one.
- `timeoutMs` (optional): the deadline for one call, default `DEFAULT_TIMEOUT_MS` (30,000 ms).

Every method also takes a last `options` argument: `{ timeoutMs?, signal? }` overrides the deadline for that call or
cancels it with an `AbortSignal`.

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

**Timeouts and cancellation.**

- **What the deadline covers:** `timeoutMs` covers the whole call: the request, reading the response body and, for
  `downloadExport`, the signed-file request and its body.
- **Always enforced:** a stalled step ends on time even if a custom `fetch` ignores the abort signal. The timer is
  cleared on success and on failure.
- **Outcomes:** when the deadline passes, the call throws `HeyQrTimeoutError` (`kind: "timeout"`, `timeoutMs`). An
  aborted `signal` throws `HeyQrAbortError` (`kind: "aborted"`); an already-aborted signal sends nothing. A failure in
  transit is a plain `HeyQrError` with `kind: "network"`.

**A timed-out or cancelled write may have been applied.** `createQr`, `updateLayout` and `updateDestination` can
reach the server and commit even though the SDK stopped waiting. Read before you retry:

- **An update:** call `getLayout` or `getDestination`. A retry with the same revision gets 409 if the first one was
  applied.
- **A create:** without a key, a retry may create a second code. With `idempotencyKey` it can't (below).

The SDK never retries on its own.

**Idempotent create retries.** Pass `idempotencyKey` to `createQr`. After a timeout or a lost response, send the same
request with the same key: HeyQR answers with the code it created the first time, with the same code and layout ids,
or creates it now if it hadn't.

- **Scope:** a key belongs to your account and to creating codes. Use a new one (`newIdempotencyKey()`) per code you
  mean to create, and keep it with the request until you have the response.
- **Same key, different request:** `HeyQrApiError` 409 `idempotency_key_reused` (`isIdempotencyConflict`). Nothing
  is created.
- **Replays don't use a draft slot.** A refused attempt (e.g. `draft_limit`) stores nothing, so the same key can be
  retried once a slot is free.
- **Retention:** keys are kept for 24 hours; after that, the same key creates a new code.
- **Who retries:** the SDK never retries on its own; the loop is yours.

```ts
import { HeyQrError, HeyQrTimeoutError, isIdempotencyConflict, newIdempotencyKey } from "@heyqr/sdk";

const idempotencyKey = newIdempotencyKey(); // one per code you mean to create
for (let attempt = 1; ; attempt++) {
  try {
    const created = await heyqr.createQr(request, { idempotencyKey, timeoutMs: 10_000 });
    break; // created.id and created.layouts are the same on every successful attempt
  } catch (error) {
    const outcomeUnknown = error instanceof HeyQrTimeoutError || (error instanceof HeyQrError && error.kind === "network");
    if (!outcomeUnknown || attempt === 3) throw error; // e.g. 422, 403 draft_limit, or isIdempotencyConflict(error)
    // Same key, same request: safe to send again.
  }
}
```

**Limits and rate limiting.**

- **Domain limits:** these are ordinary API errors with their status and code, e.g. `403 draft_limit` from
  `createQr`.
- **429:** a `429 Too Many Requests` throws `HeyQrRateLimitError`. It carries `retryAfterSeconds` (from `Retry-After`,
  seconds or an HTTP date; `null` when absent), even when the body isn't JSON, and `code` when it is. HeyQR doesn't
  rate-limit API keys today; this is ready for when it does.

**Payment required.** `isPaymentRequired(error)` narrows a 402 so `error.response.body.error.paymentUrl` is typed.
Opening it and retrying are up to you.

```ts
import {
  HeyQrAbortError,
  HeyQrError,
  HeyQrRateLimitError,
  HeyQrTimeoutError,
  isHeyQrApiError,
  isPaymentRequired,
  isRevisionConflict,
} from "@heyqr/sdk";

try {
  const file = await heyqr.downloadExport(qrId, layoutId, { format: "png" }, { timeoutMs: 15_000 });
} catch (error) {
  if (error instanceof HeyQrTimeoutError) console.warn(`Timed out after ${error.timeoutMs} ms; try again later.`);
  else if (error instanceof HeyQrAbortError) console.warn("Cancelled.");
  else if (error instanceof HeyQrRateLimitError) console.warn(`Rate limited; retry in ${error.retryAfterSeconds ?? 60} s.`);
  else if (isPaymentRequired(error)) console.info(`Pay first: ${error.response.body.error.paymentUrl}`);
  else if (isRevisionConflict(error)) console.info("Changed elsewhere: read it again.");
  else if (isHeyQrApiError(error))
    console.error(`HeyQR API ${error.status} ${error.code}`); // e.g. 403 draft_limit, 401, 404
  else if (error instanceof HeyQrError)
    console.error(`No API answer (${error.kind}).`); // network, invalid_response, download_failed
  else throw error;
}
```

| Error                 | `kind`                                                              | When                                                                                                       |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `HeyQrApiError`       | —                                                                   | a documented API error: `status`, `code`, typed `response` (401, 402, 403 `draft_limit`, 404, 409, 422, …) |
| `HeyQrTimeoutError`   | `timeout`                                                           | the deadline passed (request, body or signed download)                                                     |
| `HeyQrAbortError`     | `aborted`                                                           | the caller's `signal` cancelled the call                                                                   |
| `HeyQrRateLimitError` | `rate_limited`                                                      | 429, with `retryAfterSeconds`                                                                              |
| `HeyQrError`          | `network`, `invalid_response`, `download_failed`, `invalid_options` | no documented API answer                                                                                   |

No error contains the API key or a signed download link.

**A custom `fetch`.** The SDK passes an abort `signal` in `init`. To forward a call to the platform's `fetch`, cast the
init (the SDK has no DOM or Node types to name `AbortSignal`): `fetch: (url, init) => fetch(url, init as RequestInit)`.

**Downloads.** `downloadExport` follows how the API delivers files:

- **Hosted HeyQR:** the API answers 302 to a short-lived signed link. The SDK fetches that link in a second request
  without `Authorization`, cookies or any header (`delivery: "signed-link"`). The link never appears in an error.
- **Local server without storage:** the file comes in the response itself (`delivery: "direct"`).
- **Unpaid code:** a Static code that isn't paid for, or a Dynamic code that isn't live, throws `HeyQrApiError` 402
  `payment_required`. `response.body.error.paymentUrl` is HeyQR's Export screen for that code, layout and format. The
  owner opens it and pays; then call `downloadExport` again.
- **Never automatic:** the SDK neither opens the payment URL nor retries. Downloading again never charges.
- **Other errors:** 401 and 404 come back like the other methods'; an expired link is a `HeyQrError`.

**Updates and conflicts.** Each update starts from the revision its read returned. A layout's revision is a string
from `getLayout`; a destination's is a number from `getDestination`. If someone saved in between, the update throws
`HeyQrApiError` with status 409 and code `revision_conflict`, and nothing is saved:

- `isRevisionConflict(error)` tells you it's a conflict.
- A destination conflict also carries `response.body.error.current: { destination, revision }`.
- A layout conflict carries no current state: read the layout again.

Whether to reload and apply the change again is up to the caller. The SDK never retries (HEY-165).

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
pnpm exec tsx --conditions=@heyqr/source packages/sdk/examples/create-and-read.ts
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

### Runnable example: read and update

[`examples/read-and-update.ts`](examples/read-and-update.ts) reads a layout and a destination, renames the layout and
changes the destination from their revisions, and reports a 409 instead of retrying:

```sh
HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
HEYQR_BASE_URL=http://localhost:3000 \
HEYQR_QR_ID=<qr id> HEYQR_LAYOUT_ID=<layout id> \
HEYQR_LAYOUT_NAME="Sticker v2" HEYQR_DESTINATION=littlefern.cafe/today \
pnpm exec tsx --conditions=@heyqr/source packages/sdk/examples/read-and-update.ts
```

```json
{
  "layout": { "name": "Sticker v2", "revision": { "before": "1795600193728985", "after": "1795600227675159" } },
  "destination": { "destination": "https://littlefern.cafe/today", "changed": true, "revision": { "before": 1, "after": 2 } },
  "shortLink": "https://heyqr.example/r/k7Qm2xPa"
}
```

### Runnable example: download PNG and SVG

[`examples/download-export.ts`](examples/download-export.ts) downloads a layout's PNG (scale 4) and SVG and saves them
under their suggested names. On a 402 it prints the payment URL:

```sh
HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
HEYQR_BASE_URL=http://localhost:3000 \
HEYQR_QR_ID=<qr id> HEYQR_LAYOUT_ID=<layout id> HEYQR_OUT_DIR=. \
pnpm exec tsx --conditions=@heyqr/source packages/sdk/examples/download-export.ts
```

```json
[
  { "path": "sticker.png", "contentType": "image/png", "bytes": 260582, "delivery": "signed-link" },
  { "path": "sticker.svg", "contentType": "image/svg+xml", "bytes": 168274, "delivery": "signed-link" }
]
```

Unpaid, it prints this instead: `Payment required: open https://heyqr.example/create/export?qr=…&layout=…&format=png
as the code's owner, then run this again.`

For the whole flow from an unpaid code (402, Checkout, download, download again), see
[Buy and download a Static code's files](#buy-and-download-a-static-codes-files).

## React preview: `@heyqr/sdk/react` (HEY-167)

`HeyQrPreview` draws a live QR preview with HeyQR's own renderer, bundled into this entry.

- **Local:** it runs in the browser (or on the server, for SSR). No network request, no API key, no account. It never
  imports the server client.
- **Optional React:** React (18 or later) is an optional peer dependency. Server-only consumers of `@heyqr/sdk` don't
  need it, and installing the SDK doesn't install it.

```tsx
import { useState } from "react";
import { HeyQrPreview } from "@heyqr/sdk/react";

export function MenuPreview() {
  const [url, setUrl] = useState("https://littlefern.cafe/menu");
  const [color, setColor] = useState("#1F3A5F");
  return (
    <div>
      <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link" />
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour" />
      <HeyQrPreview
        value={url}
        color={color}
        pattern="rounded"
        eyeFrame="rounded"
        size={240}
        title="Menu QR code"
        placeholder="Type a link"
        fallback={(error) => error.message}
      />
    </div>
  );
}
```

| Prop                                                | Type                                                                                                     | Default                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `value`                                             | `string`: what the code encodes                                                                          | (required)                                |
| `pattern`                                           | `"square" \| "rounded" \| "dot" \| "diamond" \| "leaf" \| "fluid" \| "vbars" \| "hbars"` (`QR_PATTERNS`) | `"square"`                                |
| `eyeFrame`                                          | `"square" \| "rounded" \| "cushion" \| "circle" \| "leaf"` (`QR_EYE_FRAMES`)                             | `"square"`                                |
| `eyeBall`                                           | `"square" \| "rounded" \| "circle" \| "diamond" \| "leaf"` (`QR_EYE_BALLS`)                              | `"square"`                                |
| `color`, `background`, `eyeColor`, `eyeCenterColor` | `"#RRGGBB"`                                                                                              | `#111111`, `#FFFFFF`; eyes follow `color` |
| `size`                                              | pixels or a CSS length                                                                                   | `256`                                     |
| `title`                                             | accessible name                                                                                          | `"QR code"`                               |
| `className`, `style`                                | as usual                                                                                                 | —                                         |
| `placeholder`                                       | shown while `value` is empty                                                                             | an empty box                              |
| `fallback`                                          | node, or `(error) => node`, shown when it can't be drawn                                                 | an empty box                              |
| `onError`                                           | `(error: HeyQrPreviewError) => void`, once per new error                                                 | —                                         |

**How it behaves:**

- **Updates:** the preview redraws whenever `value` or a design option changes.
- **Errors:** empty input shows `placeholder`. A value too long for a QR code (`too_long`) or an unsupported shape or
  colour (`invalid_option`) shows `fallback` and calls `onError`. It never throws into your app.
- **Safety:** colours and shapes are checked before rendering, and the value is encoded into the pattern, never
  inserted as text. Nothing a caller passes can add markup to the SVG.
- **Not included:** logos and caption text belong to HeyQR's editor and the paid files.

## Build, pack and install (HEY-166)

`@heyqr/sdk` ships as **ESM only**, for Node.js 18+ (and other runtimes with `fetch`). It has no dependencies. The
package's entry points (`main`, `types`, `exports`) are the built files in `dist/`: JavaScript plus `.d.ts`
declarations, compiled from `src/` by `tsc`.

```sh
pnpm --filter @heyqr/sdk build                                  # dist/: index.js, client.js, … and their .d.ts
cd packages/sdk && pnpm pack --pack-destination /tmp            # /tmp/heyqr-sdk-<version>.tgz (rebuilds first)
tar -tzf /tmp/heyqr-sdk-*.tgz                                   # package.json, README.md, dist/*.js, dist/*.d.ts
```

**The archive:** `package/package.json`, `package/README.md`, `package/dist/<module>.js` plus `.d.ts` for `index`,
`browser`, `client`, `shared`, `qr-codes`, `layouts`, `destination`, `export`, `errors` and `json`, plus
`package/dist/react/index.js` and `.d.ts`, and the README's runnable examples (`package/examples/*.ts` with
`sticker-layout.json`). The React entry is bundled with esbuild: the renderer is inlined, and `react` and
`react/jsx-runtime` stay external.

- **Exports:** the packed `package.json` (from `publishConfig`) maps `.` to `./dist/index.js` (`import`, with
  `./dist/browser.js` under the `browser` condition) and `./react` to `./dist/react/index.js`, each with its `.d.ts`.
- **Nothing workspace-only:** no `src/`, no tests, no build or test configuration, no dependencies (React is an
  optional peer).
- **Not committed:** `dist/` and `*.tgz` are git-ignored.

**Inside the monorepo** the code and tests use the TypeScript source through the `@heyqr/source` export condition
(root `tsconfig` `customConditions`, a Vitest alias), so nothing needs building first. To run an example from
source, pass the condition to tsx (`pnpm exec tsx --conditions=@heyqr/source …`), or build first.

### Smoke test: install the .tgz in a clean project

```sh
pnpm --filter @heyqr/sdk smoke                                   # offline: install, typecheck, run
HEYQR_API_KEY=hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX \
HEYQR_BASE_URL=http://localhost:3000 \
pnpm --filter @heyqr/sdk smoke                                   # …plus the live API run
```

[`scripts/smoke.mjs`](scripts/smoke.mjs) works through these steps:

1. Builds and packs the SDK, checking that the archive holds only `package.json`, `README.md`, `dist/` files and the
   README's examples.
2. Creates a project in the OS temp directory (outside the monorepo) and installs the `.tgz` with
   `npm install <file>.tgz`.
3. Checks that `node_modules/@heyqr/sdk` is a real installed package, not a link, with no dependencies and exports
   pointing at `dist/`.
4. Typechecks and compiles [`scripts/smoke-consumer.ts`](scripts/smoke-consumer.ts), which imports only
   `"@heyqr/sdk"`, under strict `NodeNext` settings. It confirms with `--traceResolution` that `@heyqr/sdk` resolves
   to the installed `dist/index.d.ts`.
5. Runs the compiled JavaScript with plain `node`, with no loader or alias.

With `HEYQR_API_KEY`, the consumer goes on to:

1. create a Dynamic QR (with an Idempotency-Key);
2. read its layout and destination;
3. update both from their revisions;
4. read them back and assert the updates persisted;
5. check that a stale revision gets 409.

TypeScript itself comes from the monorepo, as the compiler only (`SMOKE_TSC` picks another). The consumer declares
its two globals, so it needs neither DOM nor `@types/node`. Use `SMOKE_KEEP=1` to keep the temp project for a look.

## Exports

| Area                                                         | Types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React (HEY-167), from `@heyqr/sdk/react`                     | `HeyQrPreview`, `HeyQrPreviewProps`, `HeyQrPreviewError`, `QR_PATTERNS`, `QR_EYE_FRAMES`, `QR_EYE_BALLS`, `QrPattern`, `QrEyeFrame`, `QrEyeBall`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Client (HEY-161 to HEY-165)                                  | `HeyQrClient`, `newIdempotencyKey`, `isIdempotencyConflict`, `CreateQrOptions`, `HeyQrTimeoutError`, `HeyQrAbortError`, `HeyQrRateLimitError`, `isPaymentRequired`, `isTimeout`, `retryAfter`, `DEFAULT_TIMEOUT_MS`, `RequestOptions`, `AbortSignalLike`, `HeyQrErrorKind`, `dispositionFilename`, `HeyQrApiError`, `HeyQrError`, `isHeyQrApiError`, `isRevisionConflict`, `HeyQrClientOptions`, `FetchLike`, `CreateQrError`, `GetLayoutError`, `GetDestinationError`, `UpdateLayoutError`, `UpdateDestinationError`, `DownloadExportRequest`, `DownloadExportError`, `ExportedFile` |
| Create a QR (`POST /api/v1/qr-codes`)                        | `CreateQrRequest`, `CreateQrLayout`, `QrContent`, `QrContentType`, `QrMode`, `DesignInput`, `CreateQrResponse`, `QrStatus`, `DraftLimitError`, `IdempotencyKeyReusedError`, `ContentTooLongError`, `CreateQrErrorResponse`, `CreateQrResult`                                                                                                                                                                                                                                                                                                                                          |
| A layout (`GET` / `PATCH …/layouts/{layoutId}`)              | `Layout`, `LayoutRevision`, `LayoutDesign`, `LayoutEditorSettings`, `UpdateLayoutRequest`, `LayoutRevisionConflictError`, `GetLayoutErrorResponse`, `GetLayoutResult`, `UpdateLayoutErrorResponse`, `UpdateLayoutResult`                                                                                                                                                                                                                                                                                                                                                              |
| A Dynamic code's destination (`GET` / `PATCH …/destination`) | `Destination`, `DestinationRevision`, `UpdateDestinationRequest`, `UpdateDestinationResponse`, `DestinationRevisionConflictError`, `NotDynamicError`, `GetDestinationErrorResponse`, `GetDestinationResult`, `UpdateDestinationErrorResponse`, `UpdateDestinationResult`                                                                                                                                                                                                                                                                                                              |
| Export (`GET …/layouts/{layoutId}/export`)                   | `ExportQuery`, `ExportFormat`, `ExportRedirect`, `ExportFile`, `PaymentRequiredError`, `ExportTooLongError`, `ExportTooLargeError`, `ScanCheckFailedError`, `ScanIssue`, `ExportErrorResponse`, `ExportResult`                                                                                                                                                                                                                                                                                                                                                                        |
| Errors (all routes)                                          | `ApiErrorBody`, `ApiResponse`, `CommonErrorResponse`, `UnauthorizedError`, `NotFoundError`, `MalformedJsonError`, `InvalidRequestError`, `ValidationProblem`, `InternalError`, `AnyApiErrorBody`                                                                                                                                                                                                                                                                                                                                                                                      |
| JSON                                                         | `JsonValue`, `JsonObject`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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

- `packages/sdk/test/react.test.tsx` (jsdom):
  - output is decoded with ZXing, including every shape;
  - prop changes redraw;
  - empty and too-long input;
  - unsupported or injected options;
  - SSR.
- The boundary test (`sdk-contract.test.ts`): the React entry imports only React and the renderer, React is an
  optional peer, and the server modules never import React.
- `pnpm --filter @heyqr/sdk smoke`: the packed `.tgz`, installed with npm in a clean project and run with plain
  Node.js (see above).
- `packages/sdk/test/idempotency.test.ts`:
  - the key is sent only when given, and invalid keys are refused locally;
  - the 409 is typed;
  - a retry after a timeout reuses the same key and body;
  - `newIdempotencyKey`.
- The PostgreSQL suite (`idempotent create retries`) runs the SDK against the real create route:
  - a response lost after commit, then a retry;
  - concurrent duplicates;
  - equivalent and different requests;
  - two accounts with one key;
  - a replay at the draft limit;
  - refused and rolled-back attempts;
  - the 24-hour expiry;
  - authentication of replays.
- `packages/sdk/test/errors.test.ts` (fake timers, scripted `fetch`):
  - a stalled response, a stalled body, and a stalled signed download (request or body), each ending at the deadline
    with its timer cleared;
  - cancellation and an already-aborted signal;
  - a network failure;
  - `403 draft_limit`;
  - 429 with `Retry-After` (JSON, plain text, HTTP date);
  - 402 with its payment URL;
  - 401, 404 and 409 unchanged.
- `pnpm exec vitest run packages/sdk`: the client's request path, the update bodies (only supported fields), errors
  (401, 404, 422 validation, `not_dynamic`, both 409 conflicts, 402 with the payment URL, non-JSON, network), PNG
  and SVG downloads through a signed link (no credentials sent) and directly and where the key may not appear,
  against a stubbed `fetch`.
- The PostgreSQL suite (`SDK client updates against the routes`) runs the client against the real route handlers:
  each update changes only its own resource, and stale revisions leave the saved values unchanged.
- `packages/sdk/test/live.test.ts` runs against a running API when `HEYQR_API_KEY` and `HEYQR_BASE_URL` are set
  (optionally `HEYQR_REVOKED_API_KEY`). Otherwise it's skipped.
- `pnpm --filter @heyqr/sdk typecheck` (also part of `pnpm typecheck`): the package and the examples compile, the package under its own config (no DOM, no Node
  types, `exactOptionalPropertyTypes`), and so does the clean consumer in `test/consumer`. The consumer imports only
  `@heyqr/sdk`; its `@ts-expect-error` lines must fail to compile.
- `src/server/api/v1/sdk-contract.test.ts`: the SDK types against the route schemas and response types, and SDK-typed
  samples through the server's request validation.
- The response shapes of the real routes against SDK-typed samples: the PostgreSQL suite (`SDK contract: route
responses`) and the export route's tests.
