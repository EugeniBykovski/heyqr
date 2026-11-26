# Public API v1

HEY-155 (create), HEY-156 (read and update a layout), HEY-157 (a Dynamic code's destination) and HEY-158
(export a layout's file). Keys and their verification: [API_KEYS.md](API_KEYS.md). Code: `src/app/api/v1/`, `src/server/api/v1/`.

Not in v1 yet: changing a code's content (a follow-up ticket).

**TypeScript:** every request, response and error below is typed in [`@heyqr/sdk`](../packages/sdk/README.md)
(HEY-160). Its `HeyQrClient` creates codes, reads layouts and destinations (HEY-161), and updates both from
their revisions (HEY-162), and downloads PNG and SVG exports, following the signed link (HEY-163). Every call has a timeout,
can be cancelled, and reports limits and payment errors distinctly (HEY-164).

## Authentication

Every request sends an account API key (create one under **Account → API keys**):

```
Authorization: Bearer hqk_<lookupId>_<secret>
```

The key decides the account. Nothing in a request can choose or change the owner. A missing, malformed, unknown, wrong
or revoked key gets the same answer, before the body is read:

```
401 Unauthorized
WWW-Authenticate: Bearer realm="heyqr"
{ "error": { "code": "unauthorized", "message": "A valid API key is required: Authorization: Bearer <key>." } }
```

## Rate limits

HEY-178. Budgets belong to the **account**: all its keys spend the same ones, and accounts don't affect each other. A
new key doesn't add requests.

| Budget (`error.limit`) | Counts                                              | Default        | Setting                             |
| ---------------------- | --------------------------------------------------- | -------------- | ----------------------------------- |
| `api`                  | every request with a valid key, whatever its answer | 120 per minute | `API_RATE_LIMIT_PER_MINUTE`         |
| `export`               | `GET …/export` requests, **also** counted in `api`  | 30 per minute  | `API_RATE_LIMIT_EXPORTS_PER_MINUTE` |

A window starts with the first request and lasts 60 seconds; then the budget is whole again. Requests at the end of
one window and the start of the next can add up to twice the limit in a short time. Idempotent replays count. Requests refused with
429 don't extend the wait. A key that doesn't verify gets `401` and spends nothing.

Over a budget, the request is refused before its body is read: nothing is created, changed or rendered.

```
429 Too Many Requests
Retry-After: 17
Cache-Control: no-store
{ "error": { "code": "rate_limited", "message": "Too many requests for this account. Try again later.", "limit": "api" } }
```

`Retry-After` is whole seconds until the window ends. With [`@heyqr/sdk`](../packages/sdk/README.md):

```ts
try {
  await heyqr.createQr(request, { idempotencyKey });
} catch (error) {
  if (!(error instanceof HeyQrRateLimitError)) throw error;
  // error.code === "rate_limited"; error.retryAfterSeconds === 17. Wait, then send the same request again.
}
```

If the budget can't be checked (its store fails or doesn't answer in 2 seconds), the answer is the usual
`500 internal_error` with `Retry-After: 5`, and nothing is done: the API never runs unmetered. It is reported to
monitoring as `api.rate_limit`.

Any endpoint below can answer 429. Short links, the website, Checkout and Stripe webhooks aren't part of these
budgets. The limits are counted in PostgreSQL (`api_rate_limit`), so every app instance shares them; there is no edge
limit in front of unauthenticated requests.

## POST /api/v1/qr-codes

Creates one QR code with its layouts, as a **draft** of the key's account. It is the editor's own save. The account's
draft limit applies, along with the mode and destination rules, the versioned layout contract, the static-content
capacity check and logo storage. Activation, the short link, payment and trials stay in the existing app flows. The
code appears in the account's dashboard like a code saved from the editor.

### Request

`Content-Type: application/json`. The body is strict: an unknown field is refused (`422`, `"Unknown field"`). That
includes anything that could choose an owner (`userId`, `ownerId`), address an existing code or layout (`id`,
`qrCodeId`, `layouts[].id`), claim an editor draft (`claimKey`), or set billing or activation state (`status`,
`shortCode`, `paid`, `trial`).

| Field         | Type                      | Rules                                                                                                                 |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `name`        | string                    | 1–80 characters (trimmed)                                                                                             |
| `mode`        | `"static"` \| `"dynamic"` | `dynamic` is for `website` content only                                                                               |
| `content`     | object                    | one of the content types below; the editor's content rules apply                                                      |
| `destination` | string, optional          | `dynamic` only: where the short link sends people (defaults to the website address). Same check as Change destination |
| `layouts`     | array, 1–20               | `{ "name": string (1–60), "layout": <layout>, "editor"?: <editor settings> }`                                         |

**Content types** (each object is strict; field limits in `create-qr.ts`):

| `type`     | Fields                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| `website`  | `url` (a bare domain becomes `https://`)                                                   |
| `text`     | `text` (up to 300 characters)                                                              |
| `wifi`     | `ssid`, `security` (`WPA` \| `WEP` \| `nopass`), `password` (WPA: 8+ characters), `hidden` |
| `contact`  | `firstName` or `lastName` required; `title`, `company`, `phone`, `email`, `website`        |
| `email`    | `to`, `subject`, `body`                                                                    |
| `phone`    | `number`                                                                                   |
| `sms`      | `number`, `message`                                                                        |
| `location` | `address`, `name`                                                                          |
| `event`    | `title`, `start` (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`), `end`, `place`                      |

**Layouts** use the versioned design record: `layout` is a rendered layout (`entities/qr/model/design-schema.ts`) and
`editor` holds optional editor settings. The editor produces both with `designToLayout(design)` and
`designSettingsOf(design)`. Logos are inline `data:image/…` URLs (PNG, JPEG, WebP or SVG, at most 10 MB), stored in the
account's private storage like editor uploads.

### Idempotency-Key (safe retries)

HEY-165. Send an `Idempotency-Key` header (1–255 visible ASCII characters; a UUID works) to make retrying a create
safe:

- **Same key, equivalent request, within 24 hours:** the original `201` with the same code and layout ids, marked
  `Idempotent-Replayed: true`. Nothing is created, and no draft slot is used, even if the account is now at its
  limit. "Equivalent" means equal after validation: field order, surrounding spaces in `name`, and a bare domain vs
  `https://` don't matter.
- **Same key, different request:** `409 idempotency_key_reused`. Nothing is created.
- **Scope:** a key belongs to one account and to creating QR codes. Other accounts can use the same key. Every request
  is authenticated first, replays included.
- **Only success is stored:** the stored result is written in the same transaction as the code. A refused attempt
  (`draft_limit`, `invalid_request`, …) or a rolled-back one stores nothing, so the same key can be retried. Requests
  with the same key are serialized: concurrent duplicates create exactly one code.
- **Retention:** 24 hours from the first success. After that the key is forgotten, and sending it again creates a
  new code.

**After a timeout or a lost response,** keep the key and the request and send both again. You get the code from the
first attempt if it was created, or it's created now. Use a new key for each code you mean to create.

```sh
KEY="hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX"
IDEM="$(uuidgen)"   # keep it with the request until you have a 201
curl -sS -X POST https://www.heyqr.me/api/v1/qr-codes \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM" -d @menu.json
# Timed out? Send the same request with the same Idempotency-Key again.
```

### Responses

| Status | `error.code`             | When                                                                                                         |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `201`  | —                        | created: `{ "id": "<qr id>", "status": "draft", "layouts": [{ "id": "<layout id>" }, …] }`, in request order |
| `400`  | `malformed_json`         | the body isn't JSON                                                                                          |
| `401`  | `unauthorized`           | see Authentication                                                                                           |
| `403`  | `draft_limit`            | the account already has the maximum number of drafts                                                         |
| `409`  | `idempotency_key_reused` | the `Idempotency-Key` was already used for a different request (see Idempotency-Key)                         |
| `422`  | `invalid_request`        | the body breaks a rule; `details: [{ "path": "content.url", "message": "…" }]` (never echoes values)         |
| `422`  | `content_too_long`       | static content doesn't fit in a QR code with one of the layouts                                              |
| `500`  | `internal_error`         | nothing was created; try again                                                                               |

Every error has the shape `{ "error": { "code": "…", "message": "…", "details"?: […] } }`. Responses are
`Cache-Control: no-store`. Keys, verifiers, request bodies and internal error messages are never put in responses or
logs.

### Example

```sh
curl -sS -X POST https://www.heyqr.me/api/v1/qr-codes \
  -H "Authorization: Bearer hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX" \
  -H "Content-Type: application/json" \
  -d @menu.json
```

Here `menu.json` is:

```json
{
  "name": "Menu",
  "mode": "static",
  "content": { "type": "website", "url": "littlefern.cafe/menu" },
  "layouts": [{ "name": "Sticker", "layout": { "…": "a rendered layout (see Layouts)" } }]
}
```

The response:

```
201 Created
{ "id": "Q8d3…", "status": "draft", "layouts": [{ "id": "L2k9…" }] }
```

## GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}

Returns one saved layout of the key owner's code:

```json
{
  "id": "<layout id>",
  "qrCodeId": "<qr id>",
  "name": "Sticker",
  "revision": "1764061234567890",
  "layout": { "…": "the rendered layout" },
  "editor": { "…": "editor settings, or null" }
}
```

Only these fields are returned. Stored logos come back as the image itself (`data:image/…`), never as private storage
references; a logo whose file can't be read is left out.

| Status | `error.code`   | When                                                                                                                               |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | —              | the layout                                                                                                                         |
| `401`  | `unauthorized` | see Authentication                                                                                                                 |
| `404`  | `not_found`    | the code isn't the key owner's, is deleted, doesn't exist, or the layout doesn't belong to that code (one answer for all of these) |

## PATCH /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}

Updates that layout only, from the `revision` GET returned. This is the editor's Edit design save: the layout contract,
the capacity check (the code's content must still fit), logo storage, and the revision check, made atomically under
the code's lock. The code's content, mode, destination, short link, activation, purchases and other layouts never
change.

| Field      | Type             | Rules                                      |
| ---------- | ---------------- | ------------------------------------------ |
| `revision` | string           | **required**, from GET (or the last PATCH) |
| `name`     | string, optional | 1–60 characters                            |
| `layout`   | object, optional | a rendered layout (as in create)           |
| `editor`   | object, optional | editor settings                            |

Send at least one of `name`, `layout` and `editor`. A field left out keeps its stored value; send `layout` and `editor`
together to keep them in step. Any other field is refused (`422`, `"Unknown field"`).

| Status | `error.code`        | When                                                                                                 |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `200`  | —                   | the updated layout, as GET returns it, with its new `revision`                                       |
| `400`  | `malformed_json`    | the body isn't JSON                                                                                  |
| `401`  | `unauthorized`      | see Authentication                                                                                   |
| `404`  | `not_found`         | as for GET                                                                                           |
| `409`  | `revision_conflict` | the layout was saved since that revision (from the app or another request); GET it again and reapply |
| `422`  | `invalid_request`   | a rule is broken; `details` names the field                                                          |
| `422`  | `content_too_long`  | the code's content doesn't fit with the new layout                                                   |

### Example

```sh
KEY="hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX"
URL="https://www.heyqr.me/api/v1/qr-codes/Q8d3…/layouts/L2k9…"

# Read it (note the revision).
curl -sS "$URL" -H "Authorization: Bearer $KEY"

# Rename it from that revision.
curl -sS -X PATCH "$URL" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "revision": "1764061234567890", "name": "Sticker v2" }'
```

The PATCH response is the updated layout with its new revision. Sending the old revision again gets
`409 revision_conflict`.

## GET /api/v1/qr-codes/{qrCodeId}/destination

The current destination of the key owner's Dynamic code, with the revision an update must start from:

```json
{
  "qrCodeId": "<qr id>",
  "destination": "https://littlefern.cafe/menu",
  "revision": 3,
  "previousDestination": "https://littlefern.cafe/brunch",
  "changedAt": "2026-11-25T09:30:00.000Z",
  "shortLink": "https://www.heyqr.me/r/k7Qm2xPa"
}
```

`shortLink` is `null` until the code is activated in the app. `previousDestination` and `changedAt` are `null` before the
first change.

| Status | `error.code`   | When                                                                                       |
| ------ | -------------- | ------------------------------------------------------------------------------------------ |
| `200`  | —              | the destination                                                                            |
| `401`  | `unauthorized` | see Authentication                                                                         |
| `404`  | `not_found`    | the code isn't the key owner's, is deleted, or doesn't exist (one answer for all of these) |
| `422`  | `not_dynamic`  | the owner's code is static: it has no destination                                          |

## PATCH /api/v1/qr-codes/{qrCodeId}/destination

Changes the destination from the revision GET returned. This is the dashboard's Change destination:

- **Address rule:** an explicit `http://` or `https://` URL is kept (path, query and fragment included), and a bare
  domain becomes `https://`. Blank input, spaces, other schemes, credentials and hosts without a dot are refused.
- **Atomic and revision-checked**, under the code's lock.
- **History:** a real change advances the revision by one and records one history entry (shown in QR details).
- **Same address:** sending the address already stored, at the current revision, writes nothing. The revision and
  history stay as they are, and the response says `"changed": false`.

The code's id, short link, layouts, scans and activation never change. The short link redirects (`302`,
`Cache-Control: no-store`) to the new destination at once.

Body (strict; any other field is refused):

| Field         | Type    | Rules                                      |
| ------------- | ------- | ------------------------------------------ |
| `destination` | string  | the new address, up to 2048 characters     |
| `revision`    | integer | **required**, from GET (or the last PATCH) |

| Status | `error.code`        | When                                                                                                                                                          |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | —                   | the destination as GET returns it, plus `"changed": true` or `false`                                                                                          |
| `400`  | `malformed_json`    | the body isn't JSON                                                                                                                                           |
| `401`  | `unauthorized`      | see Authentication                                                                                                                                            |
| `404`  | `not_found`         | as for GET                                                                                                                                                    |
| `409`  | `revision_conflict` | the destination changed since that revision (in the app or another request); nothing was saved. `error.current` is `{ "destination", "revision" }` now stored |
| `422`  | `invalid_request`   | the address or the body breaks a rule; `details` names the field                                                                                              |
| `422`  | `not_dynamic`       | as for GET                                                                                                                                                    |

A request that matches the stored destination but uses an older revision is still `409`, even when the URL looks the
same (A → B → A).

### Example

```sh
KEY="hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX"
URL="https://www.heyqr.me/api/v1/qr-codes/Q8d3…/destination"

# Read the current destination and revision.
curl -sS "$URL" -H "Authorization: Bearer $KEY"
# → { "destination": "https://littlefern.cafe/menu", "revision": 3, … }

# Change it from that revision.
curl -sS -X PATCH "$URL" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "destination": "https://littlefern.cafe/today", "revision": 3 }'
# → { "destination": "https://littlefern.cafe/today", "revision": 4, "changed": true, … }
```

On `409`, use `error.current.revision` (or GET again), check the destination now stored, and send your change again if
it still applies.

## GET /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}/export

A layout's full-size file. The file comes from the same private export flow as the dashboard's downloads, and the same
download rule applies:

- **Static code:** its one-time purchase.
- **Dynamic code:** live under a plan, or the running free trial's test code.

Every request is checked again, before anything is rendered or signed, including when the file was already prepared. A
refunded purchase or an ended plan takes effect on the next request.

Query (strict; any other parameter is refused):

| Parameter     | Rules                                             |
| ------------- | ------------------------------------------------- |
| `format`      | **required**: `png`, `svg` or `pdf`               |
| `dpi`         | PNG of a print (mm) layout: 72–1200 (default 300) |
| `scale`       | PNG of a screen (px) layout: 1–8 (default 2)      |
| `transparent` | `1` for a transparent background                  |

| Status | `error.code`                                   | When                                                                                                                                       |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `302`  | —                                              | the file: `Location` is a short-lived signed link to it (`Cache-Control: private, no-store`). Follow it without the `Authorization` header |
| `401`  | `unauthorized`                                 | see Authentication                                                                                                                         |
| `402`  | `payment_required`                             | the owner's code isn't paid for or live yet: see below                                                                                     |
| `404`  | `not_found`                                    | the code isn't the key owner's, is deleted or missing, or the layout doesn't belong to it (one answer for all of these)                    |
| `422`  | `invalid_request`                              | a missing or unsupported `format`, or another option out of range; `details` names it                                                      |
| `422`  | `too_long` / `too_large` / `scan_check_failed` | the file can't be made as asked                                                                                                            |

### Payment required

```json
{
  "error": {
    "code": "payment_required",
    "message": "This code's files need a one-time purchase. Open paymentUrl, signed in as the owner, to pay; then repeat this request.",
    "paymentUrl": "https://www.heyqr.me/create/export?qr=Q8d3…&layout=L2k9…&format=png",
    "qrCodeId": "Q8d3…",
    "layoutId": "L2k9…",
    "format": "png"
  }
}
```

`paymentUrl` is the code's Export screen in HeyQR, for the same code, layout and format:

- The owner signs in there (it never carries the API key) and chooses to pay. For a Dynamic code, they activate it with
  a plan or the free trial.
- The API request itself creates no charge, no Checkout Session and no order.
- Once Stripe's verified webhook has unlocked the code, the same API request returns the file.
- Downloading again, through the API or the dashboard, never charges again or uses a credit.

### Example

```sh
KEY="hqk_XXXXXXXXXXXX_YOUR-SECRET-PART-GOES-HERE-XXXXXXXXXXXXXXXXXXX"
URL="https://www.heyqr.me/api/v1/qr-codes/Q8d3…/layouts/L2k9…/export?format=png"

# Not paid yet: 402 with paymentUrl (open it in a browser as the owner).
curl -sS "$URL" -H "Authorization: Bearer $KEY"

# Paid: follow the redirect to the file. curl drops the Authorization header on the redirect to another host.
curl -sS -L -o menu.png "$URL" -H "Authorization: Bearer $KEY"
```
