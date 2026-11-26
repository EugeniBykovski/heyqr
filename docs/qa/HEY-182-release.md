# HEY-182 release candidate · acceptance on one head

Branch `release/HEY-182-hosted-types-static-checkout`, base `a0d84be` (main), accepted head `7b5fcce`. Run on
2026-11-26. Details per deliverable: [HEY-182-static-checkout.md](HEY-182-static-checkout.md) (checkout) and the board
coverage below (hosted types). Jira HEY-182 couldn't be read (the Atlassian connector has no access to that site), so
acceptance follows the request text.

## Environment

Production build (`next build` + `next start`) of `7b5fcce` on `localhost:3193`, `APP_ENV=dev`, its own local
PostgreSQL database (22 of 22 migrations), Stripe **test mode** with signed webhooks from the Stripe CLI, private
storage on `scripts/qa/fake-s3.mjs`. Nothing in this run touched Neon production, R2 or live Stripe.

## Critical checks

| Check                                                                                            | Result                  | Evidence                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Lint (0 errors), typecheck, `pnpm test` (1,089), `pnpm test:db` (238), build                     | PASS                    | final-head run                                                                                                         |
| Fresh account A, Chromium 1440: guest → sign-in keeps draft → Checkout → download → repeat       | PASS 8/8                | `evt_1Ug0m9F0rhTjr7bDulxdkUHa`; PNG decodes to the input; orders/sessions/charges 1/1/1                                |
| Fresh account B, WebKit 390: same journey                                                        | PASS 8/8                | `evt_1Ug0okF0rhTjr7bDC2cAXQiw`; 1/1/1                                                                                  |
| Paid access from the verified webhook only (held webhook → "Confirming your payment…", 402)      | PASS                    | both runs                                                                                                              |
| Cancellation: draft kept, export locked, Checkout resumes                                        | PASS 5/5                | Chromium 1440; 2 sessions, 0 charges                                                                                   |
| Preparation failure after payment: error + Try again, retry on the same purchase                 | PASS 6/6                | WebKit 390; 1 order, 1 session, 1 charge                                                                               |
| Another account can't reach the paid file (export page, file API, prepare, all files, code)      | PASS                    | every route 404; signed out 401                                                                                        |
| Page 11 publish loop: 7 types create → Export → Go live, signed-out short link, edit at same URL | PASS 22/22 ×2           | Chromium, WebKit                                                                                                       |
| Page 11 public states: expired coupon, phone-only business, PDF, loading, unavailable, drafts    | PASS 15/15 ×2           | Chromium, WebKit                                                                                                       |
| Page 11 editor states 11.1–11.16 at 390 / 834 / 1440                                             | PASS 17/17 ×3           | Chromium (all 3 engines on the hosted branch: 153/153)                                                                 |
| Genuine Google OAuth sign-in                                                                     | NOT RUN                 | needs a person; the redirect to Google's consent was genuine                                                           |
| Live Stripe, 3-D Secure in live mode, real R2, physical phone scans                              | NOT RUN                 | outside a test run                                                                                                     |
| Production domain `https://www.heyqr.me`                                                         | NOT RUN                 | not deployed there                                                                                                     |
| `@heyqr/qr-core` / `@heyqr/sdk` from the public registry                                         | NOT RUN                 | blocked: both 0.1.0 answer 404 on registry.npmjs.org (unpublished, `private`)                                          |
| Local tarball smoke (clean project outside the monorepo)                                         | SDK PASS · qr-core FAIL | SDK imports in Node, refuses in a browser build; qr-core exports TS source, Node refuses `node_modules` type stripping |

A first WebKit run stopped at "Confirming your payment…" because that invocation started without the Stripe listener:
the screen correctly waited for a verified webhook. Rerun as a new fresh account with the listener: PASS.

## Migrations

`0021_qr_takedown` adds nullable `qr_code.taken_down_at` (and its note); checked on a database with 24 hosted codes
and 42 published versions: row counts and checksums unchanged. Neon: `preview` branch rehearsal (21 → 22, second run
applies nothing, `db:verify` ok), then production `neondb`: 22 of 22 applied with `APP_ENV=production` and
`CONFIRM_PRODUCTION_MIGRATION=1`, 24 tables, second run "Up to date".
