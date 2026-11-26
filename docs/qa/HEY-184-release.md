# HEY-184 · acceptance on one commit

Branch `feat/HEY-184-create-cross-browser-download`, base `2b2dfa8` (main; HEY-182 and HEY-183 merged), accepted code
`bfad3e2`. Run on 2026-11-26. Jira HEY-184 couldn't be read (the Atlassian connector has no access to that site), so
acceptance follows the request text. Journey details:
[HEY-184-cross-browser-download.md](HEY-184-cross-browser-download.md).

## Environment

Production build (`next build` + `next start`) of `bfad3e2` on `localhost:3199`, `APP_ENV=dev`, its own local
PostgreSQL database (22 of 22 migrations), Stripe **test mode** with signed webhooks from the Stripe CLI, private
storage on `scripts/qa/fake-s3.mjs`. **Not a deployed Preview:** Preview deployments fail because their Vercel
environment variables aren't set, and the Vercel CLI isn't signed in here.

## Critical checks

| Check                                                                                    | Result                  | Evidence                                                                                             |
| ---------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Lint (0 errors), typecheck, `pnpm test` (1,105), `pnpm test:db` (239), build             | PASS                    |                                                                                                      |
| Account 1: browser A Chromium 156 → browser B Firefox 157 (clean profile), 1440          | PASS 10/10              | baseline PNG 1024×1024 22.4% `#1f5c45`; revised PNG 1024×1250 19.1% `#1f4e8c`, 0% `#1f5c45`          |
| Account 2: browser A Chromium 156 → browser B WebKit 27.2 (clean profile), 390           | PASS 10/10              | revised PNG 18.5% `#1f4e8c`, 0% `#1f5c45`                                                            |
| B's SVG and PNG are the saved design                                                     | PASS                    | SVG byte-identical and PNG pixel-identical to `renderExport` of the saved layout; caption in the SVG |
| All files decode to the original payload                                                 | PASS                    | `https://qa184-final-acct5.example/menu?src=print`, `…acct6…`                                        |
| B reuses the purchase: no new Checkout, order or charge                                  | PASS                    | orders / paid / sessions / charges 1/1/1/1 before and after B                                        |
| Another account can't reach the paid files                                               | PASS                    | PNG, SVG, prepare, all files 404; no content on the pages; signed out 401                            |
| Create boards 1.1–1.16 (quick create, preview, Type → Content → Design, keyboard, focus) | PASS 95/95              | Chromium and WebKit at 390 / 834 / 1440, Firefox 1440                                                |
| Deployed Preview run, Preview URL and deployed SHA                                       | NOT RUN                 | Preview builds fail (env not set); Vercel CLI not signed in                                          |
| Genuine Google OAuth sign-in                                                             | NOT RUN                 | needs a person; the redirect to Google's consent was genuine in every browser                        |
| Live Stripe, real R2                                                                     | NOT RUN                 | outside a test run                                                                                   |
| `@heyqr/qr-core` / `@heyqr/sdk` from the public registry                                 | NOT RUN                 | both 0.1.0 answer 404 on registry.npmjs.org (unpublished, `private`)                                 |
| Local tarball smoke (packages unchanged since `066c370`)                                 | SDK PASS · qr-core FAIL | qr-core exports TS source; Node refuses `node_modules` type stripping                                |

Four earlier attempts on this head stopped in the harness, not the app: two before the Stripe listener was started (the
screen correctly stayed on "Confirming your payment…"), two because the file inspector ran without
`STRIPE_WEBHOOK_SECRET` in its environment. Each rerun used new fresh accounts.

No migrations in this change.
