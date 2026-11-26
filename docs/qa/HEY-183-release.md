# HEY-183 · acceptance on one commit

Branch `feat/HEY-183-qr-types-dynamic-checkout`, base `2e5d75f` (main, HEY-182 already merged), accepted code
`3e5584d`. Run on 2026-11-26. Jira HEY-183 couldn't be read (the Atlassian connector has no access to that site), so
acceptance follows the request text. Journey details: [HEY-183-dynamic-journey.md](HEY-183-dynamic-journey.md).

## Environment

Production build (`next build` + `next start`) of `3e5584d` on `localhost:3196`, `APP_ENV=dev`, its own local
PostgreSQL database (22 of 22 migrations), Stripe **test mode** with signed webhooks from the Stripe CLI, private
storage on `scripts/qa/fake-s3.mjs`. **Not a deployed Preview:** Preview deployments fail because their Vercel
environment variables aren't set, and the Vercel CLI isn't signed in here.

## Critical checks

| Check                                                                                      | Result                  | Evidence                                                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| Lint (0 errors), typecheck, `pnpm test` (1,096), `pnpm test:db` (239), build               | PASS                    |                                                                                           |
| Account A, Chromium 1440, Starter via Stripe test Checkout                                 | PASS 10/10              | `sub_1Ug1mVF0rhTjr7bDTuJHXdMs`, `ch_3Ug1mUF0rhTjr7bD05v8H7AO` $9.00; `/r/Zt5KaKT`         |
| Account B, WebKit 390, 7-day trial (no card)                                               | PASS 10/10              | trial to 2026-12-03; `/r/yhtw75L`                                                         |
| Draft, design (Forest) and export intent (PNG 600 dpi) survive sign-in                     | PASS                    | both accounts                                                                             |
| The code goes live only from server state (webhook / trial grant)                          | PASS                    | both accounts                                                                             |
| Original file → short link → **A** before the change                                       | PASS                    | decoded PNG; `302` to `…final-A-A` / `…final-B-A`, `Cache-Control: no-store`              |
| Change to B persists; the **same original file** → same short link → **B**                 | PASS                    | `302` to `…-B`; no new code, short code, order or Checkout; repeat requests never serve A |
| Invalid destination refused (form, API v1 422), B stays                                    | PASS                    | both accounts                                                                             |
| Another account can't read or change the destination (page, API v1 GET / PATCH)            | PASS                    | 404, nothing leaked                                                                       |
| Page 10 boards 10.1–10.8: Explore tabs, CTA handoff, Type rules, Menu, After scan, loading | PASS 13/13 ×7           | Chromium and WebKit at 390 / 834 / 1440, Firefox 1440                                     |
| Deployed Preview run, Preview URL and deployed SHA                                         | NOT RUN                 | Preview builds fail (env not set); Vercel CLI not signed in                               |
| Genuine Google OAuth sign-in                                                               | NOT RUN                 | needs a person; the redirect to Google's consent was genuine                              |
| Live Stripe, physical phone scans, real R2                                                 | NOT RUN                 | outside a test run                                                                        |
| `@heyqr/qr-core` / `@heyqr/sdk` from the public registry                                   | NOT RUN                 | both 0.1.0 answer 404 on registry.npmjs.org (unpublished, `private`)                      |
| Local tarball smoke (packages unchanged since `066c370`)                                   | SDK PASS · qr-core FAIL | qr-core exports TS source; Node refuses `node_modules` type stripping                     |

No migrations in this change.
