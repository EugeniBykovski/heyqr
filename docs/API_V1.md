# Public API v1

HEY-155 (create) and HEY-156 (read and update a layout). Keys and their verification: [API_KEYS.md](API_KEYS.md). Code: `src/app/api/v1/`, `src/server/api/v1/`.

Not in v1 yet: changing a code's content or destination, paid file export, and idempotent create retries (follow-up
tickets).

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

### Responses

| Status | `error.code`       | When                                                                                                         |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `201`  | —                  | created: `{ "id": "<qr id>", "status": "draft", "layouts": [{ "id": "<layout id>" }, …] }`, in request order |
| `400`  | `malformed_json`   | the body isn't JSON                                                                                          |
| `401`  | `unauthorized`     | see Authentication                                                                                           |
| `403`  | `draft_limit`      | the account already has the maximum number of drafts                                                         |
| `422`  | `invalid_request`  | the body breaks a rule; `details: [{ "path": "content.url", "message": "…" }]` (never echoes values)         |
| `422`  | `content_too_long` | static content doesn't fit in a QR code with one of the layouts                                              |
| `500`  | `internal_error`   | nothing was created; try again                                                                               |

Every error has the shape `{ "error": { "code": "…", "message": "…", "details"?: […] } }`. Responses are
`Cache-Control: no-store`. Keys, verifiers, request bodies and internal error messages are never put in responses or
logs.

### Example

```sh
curl -sS -X POST https://heyqr.example/api/v1/qr-codes \
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
URL="https://heyqr.example/api/v1/qr-codes/Q8d3…/layouts/L2k9…"

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
