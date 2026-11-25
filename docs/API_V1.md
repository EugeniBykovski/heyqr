# Public API v1

HEY-155 (create). Keys and their verification: [API_KEYS.md](API_KEYS.md). Code: `src/app/api/v1/qr-codes/route.ts`,
`src/server/api/v1/create-qr.ts`.

Not in v1 yet: reading and updating codes, paid file export, and idempotent create retries (follow-up tickets).

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
