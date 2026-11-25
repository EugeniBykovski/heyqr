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
- Management views list only safe metadata: the prefix, creation date, state (active or revoked) and last use.
- Every API path that accepts a key must scope QR data to the account id `apiKeyOwner(db, key)` returns, on the server
  (the public API: [API_V1.md](API_V1.md)).
- Deleting an account deletes its keys.

## Revocation and last use (HEY-154)

- `api_key.revoked_at` (set once) and `api_key.last_used_at`, both nullable: keys issued before migration 0016 stay
  active.
- **Revoke** (API keys page, with confirmation) is scoped to the signed-in account: another account's key id reads as
  not found. Revoking again is harmless and keeps the original time.
- **The shared verifier `apiKeyOwner(db, key)`** returns only the owner's account id, or `null`. It compares the secret
  in constant time, then claims the key with one conditional update (`… where revoked_at is null`) that also sets
  `last_used_at`. So an attempt that starts after a revocation has committed is refused, a refused key (malformed,
  unknown, wrong secret or revoked) is indistinguishable from any other `null`, and only successful attempts change
  `last_used_at`. Revoking one key leaves the account's other keys working.
- The page shows each key as Active (with its last use) or Revoked (with the date), never the secret or verifier.
- `POST /api/v1/qr-codes` (HEY-155) authenticates with the verifier; HEY-159 adds the other endpoints.
