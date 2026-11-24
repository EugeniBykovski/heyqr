# API keys

HEY-153 (issuing) and HEY-154 (verification and revocation). An API key lets an account's own tools reach that
account's QR codes. Code: `src/server/api-keys/keys.ts`.

## Format

```
hqk_<lookupId>_<secret>
```

| Part       | Content                                                              | Stored                                                                   |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `hqk_`     | fixed prefix, so a leaked key is recognisable                        | —                                                                        |
| `lookupId` | 12 characters `[A-Za-z0-9]`, random                                  | `api_key.lookup_id` (unique); shown as the key's prefix `hqk_<lookupId>` |
| `secret`   | 32 random bytes from `crypto.randomBytes`, base64url (43 characters) | **never**                                                                |

The verifier is `api_key.secret_hash = "sha256:" + hex(SHA-256(secret))`. The secret has 256 bits of entropy, so a fast
hash is enough. A presented key is parsed (`parseApiKey`), its row found by `lookupId`, and the verifier compared in
constant time (`apiKeyOwner`).

## Rules

- A key is issued only for the signed-in account; the owner comes from the server session, never from the request.
- The full key appears in exactly one place: the response of the server action that created it. It isn't stored, logged,
  put in a URL, counted in analytics, or rendered by any page. The UI shows it once, with Copy and a warning; Done,
  leaving or refreshing the page clears it.
- Management views list only the prefix and creation date.
- Every API path that accepts a key must scope QR data to `apiKeyOwner(...).userId` on the server.
- Deleting an account deletes its keys.

## For HEY-154

Verification builds on `apiKeyOwner`; revocation needs a `revoked_at` (and, if wanted, `last_used_at`) column on
`api_key`, and `apiKeyOwner` should then refuse revoked keys. No public QR endpoint accepts keys yet (HEY-155, HEY-159).
