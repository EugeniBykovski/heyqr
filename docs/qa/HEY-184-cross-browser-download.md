# HEY-184 · A purchased Static QR, redesigned in one browser, downloaded again in another

Branch `fix/HEY-184-cross-browser-download`, base `2b2dfa8`. Run on 2026-11-26 against a production build (`next build`
\+ `next start`) on `localhost:3198`. The Jira issue couldn't be read (the Atlassian connector has no access to that
site), so this follows the acceptance text of the request.

- **Environment:** `APP_ENV=dev`, its own PostgreSQL database (`heyqr_hey184_xb`, 22 of 22 migrations), private storage
  on `scripts/qa/fake-s3.mjs` (the same store-once-then-signed-link path as R2). **Not a deployed Preview:** Preview
  deployments fail (their Vercel environment isn't set) and the Vercel CLI isn't signed in.
- **Stripe:** test mode (`sk_test_…`, every session and payment `livemode: false`), the Stripe CLI forwarding signed
  webhooks.
- **Script:** `scripts/qa/cross-browser-download.mjs <engineA> <engineB> <width>`. Browser A and browser B are separate
  browser processes, so B starts from a clean profile (no cookies, no storage).
- **File inspection:** `scripts/qa/inspect-export.ts` decodes each file with ZXing and renders the layout **as saved in
  the database** with the server's own `renderExport` (what `/api/export` runs), then compares: SVG byte for byte, PNG
  pixel for pixel, plus the colours present and the caption text.

## Genuine and fixture

| Step                                                      | How it ran                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest editor, Export, Edit design, My QR codes, downloads | Genuine browser flow                                                                                                                                                                           |
| Continue with Google (A and B)                            | **Genuine up to Google:** a real `accounts.google.com` consent URL with the configured client, `redirect_uri=…/api/auth/callback/google`, code flow, state, `openid email profile`             |
| Completing Google sign-in                                 | **Fixture:** the account Google returns is written as Better Auth writes it (user, Google account, session); B returns as the same account. **Genuine Google OAuth: NOT RUN** (needs a person) |
| Checkout and unlock                                       | **Genuine Stripe test mode:** real Checkout, card 4242, signed `checkout.session.completed`                                                                                                    |

## Results

| Account | Browser A → B              | Width | Result     |
| ------- | -------------------------- | ----- | ---------- |
| 1       | Chromium 156 → Firefox 157 | 1440  | PASS 10/10 |
| 2       | Chromium 156 → WebKit 27.2 | 390   | PASS 10/10 |

Each run: guest creates a Static Website QR (Dots, Forest `#1f5c45`) → Export → Continue with Google → Stripe test
Checkout → baseline PNG (4×) and SVG → Edit design on the purchased code: colour Ocean `#1f4e8c` and a caption (the
layout switches to "QR + caption"), Save changes; content unchanged → browser B signs in, opens the code from My QR codes
(the page renders `#1f4e8c` and the caption), downloads PNG and SVG again.

| Evidence                                            | Account 1                                                                                         | Account 2                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Checkout Session / payment                          | `cs_test_b07fK3DU…`, `pi_3Ug2y0F0rhTjr7bD0gOx2uHX` $4.99                                          | `cs_test_b0yv859N…`, `pi_3Ug2yWF0rhTjr7bD10tEKpA2` $4.99 |
| Baseline PNG (A)                                    | 1024×1024, pixel-identical to the saved render, 22.6% `#1f5c45`                                   | 1024×1024, identical, 22.3% `#1f5c45`                    |
| Revised PNG (B)                                     | 1024×1250 (caption), **pixel-identical to the saved render**, 19.1% `#1f4e8c`, **0%** `#1f5c45`   | 1024×1250, identical, 19.0% `#1f4e8c`, 0% `#1f5c45`      |
| Revised SVG (B)                                     | **byte-identical to the saved render**; fills `#ffffff`, `#1f4e8c`; text "Scan acct1"             | identical; `#ffffff`, `#1f4e8c`; "Scan acct2"            |
| Decoded (all four files)                            | `https://qa184-acct1.example/menu?src=print`                                                      | `https://qa184-acct2.example/menu?src=print`             |
| Orders / paid / sessions / charges before → after B | 1/1/1/1 → 1/1/1/1                                                                                 | 1/1/1/1 → 1/1/1/1                                        |
| Stored objects                                      | 4: baseline PNG + SVG under revision `13:43:58.936Z`, revised under `13:44:13.228Z`               | 4: `13:44:30.504Z`, `13:44:44.362Z`                      |
| Another account                                     | file routes 404 (PNG, SVG, prepare, all files), no content on export or code page; signed out 401 | same                                                     |

## The save → export path

No stale output and no lost access: browser B received the revised files on the original purchase. The path, traced:
`updateLayout` writes the design and moves `qr_layout.updated_at` (the revision, HEY-85) → `/api/export` checks the
owner and the entitlement on every request → `deliverLayoutExport` keys the stored file by user, code, layout,
**revision** and a digest of the settings, **saved design**, encoded value and name (`paidFileKey`) → a new design is a
new object, rendered once from the saved layout; earlier objects stay for links already issued.
`src/server/qr/layout-export.test.ts` now covers this (it fails if the design leaves the key): a redesign gets its own
file, two saves in the same millisecond still differ, another browser gets the same stored file, and the payload stays.

## Not run

- Deployed Preview with an isolated Neon branch: blocked as above. To run it there:
  `BASE=https://<preview> QA_DATABASE_URL=<Preview Neon branch, direct> BETTER_AUTH_SECRET=<Preview> GOOGLE_CLIENT_ID=<Preview> STRIPE_SECRET_KEY=<sk_test_…> M=<out> node scripts/qa/cross-browser-download.mjs chromium firefox 1440`
  (and `chromium webkit 390` for the second account). Checkout webhooks go to the Preview's own endpoint; the script
  refuses a target whose health reports production. A protected Preview also needs Vercel's bypass token.
- Genuine Google OAuth end to end, live Stripe, real R2.
