# HEY-192 · language switcher and 21 locales, acceptance on one commit

Branch `feat/HEY-192-language-switcher-i18n`, base `36a37a4` (main, HEY-191 merged), accepted commit `4b2de92`. Run on
2026-11-26. Jira HEY-192 couldn't be read (the Atlassian connector has no access to that site), so acceptance follows
the request text; the locale list comes from `src/i18n/locales.ts` (HEY-64's approved list wasn't readable).

## Locales

The 21 interface languages, in switcher order: en, es, zh, hi, ar, pt, fr, de, ru, ja, ko, it, tr, id, vi, pl, uk, be,
nl, th, sv. Arabic is the only right-to-left locale. Before this change only `en` and a partial `ru` (615 keys) had
catalogs; every other language fell back to English.

- `src/i18n/catalog-parity.test.ts` requires every catalog to match English: same keys and array lengths, the same ICU
  arguments, rich-text tags and code spans per string, unchanged docs structure fields, no blank values or raw keys.
- All 20 non-English catalogs are complete (3,131 values each). Plurals use each language's CLDR categories (Slavic:
  one/few/many/other; Arabic: all six). Brand and product names, sample content, code, URLs and API identifiers are
  unchanged. The docs' scan issue table stays in English in every locale: it documents the strings `@heyqr/qr-core`
  returns. Each locale names the Single QR offer the same way on every screen.

## Environment

Production build of `4b2de92` on `localhost:3208`, `APP_ENV=dev`, its own local PostgreSQL database (22 migrations,
dev seed plus accounts in each billing state), private storage on `scripts/qa/fake-s3.mjs`. No Stripe calls: the
billing checks assert that switching language starts no Checkout and writes no purchase.

## Critical checks

| Check                                                                                                                    | Result                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Lint (0 errors), typecheck, `pnpm test` (1,176 incl. 22 catalog checks), `pnpm test:db` (242), build                     | PASS                                                                      |
| Switcher: keyboard open and select, visible focus, Escape returns focus, 21 options reachable, panel fits the viewport   | PASS (7/7 × Chromium and WebKit at 390 / 834 / 1440, Firefox 1440)        |
| Persistence: the chosen language survives a reload (NEXT_LOCALE cookie), SSR and client agree                            | PASS                                                                      |
| Guest mid-creation: switch to Ukrainian on Content and French on Design; step, type and typed Wi-Fi name kept; Back kept | PASS                                                                      |
| Signed in: My QR codes (Polish) and Trial & usage (Swedish) stay signed in, same codes, no purchase rows                 | PASS                                                                      |
| Pricing and Export in PLN: plan, currency, amount, code and format unchanged; no Checkout, no purchase                   | PASS                                                                      |
| Arabic: `dir="rtl"`, mirrored header, no overflow on 7 key pages; addresses, sizes and the QR stay LTR                   | PASS                                                                      |
| 21-locale smoke (home, create, pricing, dashboard): `lang`/`dir`, no raw keys, no blank labels, 0 English headings       | PASS (Firefox 1440)                                                       |
| Six linked pages' routes × 21 locales: heading, switcher, no overflow, no raw keys, correct `lang`/`dir`                 | PASS 147/147 × 5 (Chromium 390 / 1440, WebKit 390 / 834, Firefox 1440)    |
| Checkout in a deployed Preview with Stripe Sandbox                                                                       | NOT RUN: Preview deployments fail (env not set); Vercel CLI not signed in |
| Pixel comparison against the boards                                                                                      | NOT RUN                                                                   |

## Discrepancies

- `user.locale` exists in the schema but nothing reads or writes it; the preference is next-intl's `NEXT_LOCALE` cookie.
- State carried across a switch lives in memory for 10 s: a full reload mid-switch still loses unsaved signed-in edits
  (guest drafts are in storage and survive).
- The homepage caption keeps the previous language's default text after a switch, because it is carried as typed
  content.
