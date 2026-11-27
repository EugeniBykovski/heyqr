# Terms and Privacy · draft for owner and legal review (HEY-193)

`/terms` and `/privacy` show **drafts**: a visible banner says so, both pages are `noindex`, and every fact that still
needs a decision is a highlighted placeholder (`[[…]]` in `src/shared/content/legal/en/*.ts`). Remove the banner and
`robots: { index: false }` (in `src/app/[locale]/terms|privacy/page.tsx`) only after approval.

## For owner / legal review

| #   | Where                                               | Item                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Terms intro, Privacy intro                          | Legal name and registered address of the company that runs HeyQR (provider and controller)                                                                                                                                                    |
| 2   | Terms (account, contact), Privacy (rights, contact) | Support and privacy contact email addresses. `SUPPORT_EMAIL` is required in production but its value isn't in the repo                                                                                                                        |
| 3   | Terms · account                                     | Minimum age                                                                                                                                                                                                                                   |
| 4   | Terms · refunds                                     | Refund policy: when refunds are given, how to ask, statutory withdrawal right for consumers (the product removes what a refunded payment unlocked, HEY-100)                                                                                   |
| 5   | Terms · Dynamic codes                               | Any availability commitment for short links and hosted pages                                                                                                                                                                                  |
| 6   | Terms · moderation                                  | Notice and appeal process for take-downs and account suspension                                                                                                                                                                               |
| 7   | Terms · liability                                   | Limitation of liability and warranty disclaimers                                                                                                                                                                                              |
| 8   | Terms · changes                                     | Notice period for changes; governing law and courts                                                                                                                                                                                           |
| 9   | Privacy · why we use it                             | Legal bases per purpose, where the law requires them                                                                                                                                                                                          |
| 10  | Privacy · providers                                 | Database region: resolved in HEY-188 (Neon project `heyqr`, region `aws-us-east-2`, read from Neon). Open: storage provider (R2 or S3; the repo documents R2 but the production value isn't readable here), international transfer safeguards |
| 11  | Privacy · retention                                 | How long deleted codes are kept before permanent removal (today: kept, restorable, no purge job); retention for sessions, billing records, reports and release-update emails                                                                  |
| 12  | Privacy · rights                                    | Response time, applicable rights, supervisory-authority complaint; DPO or EU/UK representative if required                                                                                                                                    |
| 13  | Both                                                | Effective date: resolved in HEY-188, 2026-11-27 for both documents (confirmed by the owner). Open: whether the text must be translated                                                                                                        |
| 14  | Product gap                                         | No self-service account deletion or data export (backlog HEY-6): requests go by email for now                                                                                                                                                 |
| 15  | Product gap                                         | `user.locale` and Google sign-in tokens (`account.access_token`, `refresh_token`, `id_token`) are stored by Better Auth; confirm they are needed or stop storing the tokens                                                                   |

## Evidence for each statement

| Statement                                                                 | Source                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Google is the only sign-in; sessions in Postgres                          | `src/server/auth.ts` (Better Auth, `socialProviders.google`)                                                   |
| Session IP address and user agent                                         | `session.ip_address`, `session.user_agent` (`src/server/db/schema.ts`)                                         |
| Name, email, picture, Google account ID and tokens                        | `user`, `account` tables                                                                                       |
| Scans: one count per code and day, nothing about the scanner              | `scan_daily (qr_code_id, day, count)`; `src/server/qr/scans.ts` (`incrementScan`, `isCountableScan`)           |
| Report: reason, details, optional email, hashed IP                        | `page_report`; `reporterHash` = SHA-256 of secret + IP (`src/server/qr/hosted-public.ts`)                      |
| API keys: lookup ID and hash only; last used; rate-limit counters         | `api_key`, `api_rate_limit`, `api_idempotency_key`                                                             |
| Release-update emails; anonymous docs feedback                            | `developer_notify (email, topic)`, `doc_feedback (page, helpful)`                                              |
| Stripe receives email, account ID and what's bought                       | `src/server/billing/customer.ts` (`email`, `metadata.userId`), `checkout.ts` metadata                          |
| Card details never reach HeyQR                                            | Stripe-hosted Checkout and Portal only                                                                         |
| Receipt emails via Resend (name, email, amount, link)                     | `src/server/email/send.ts` `sendPurchaseReceipt`                                                               |
| Sentry sends no user info, cookies, headers, bodies or query strings      | `src/shared/lib/monitoring/options.ts` `dataCollection`, `beforeSend` sanitizer                                |
| Cookies: Better Auth session, `NEXT_LOCALE`; no ads or analytics          | `src/server/auth.ts`, next-intl routing; no analytics package in `package.json`                                |
| Browser storage: guest draft, recovery, editor preferences                | `heyqr:draft:v1` and keys in `src/features/qr-editor/{use-draft,edit-recovery,use-stage-view}.ts`              |
| Unused logo uploads removed after 24 h                                    | `src/server/db/assets-cleanup.ts` (`pnpm assets:cleanup`)                                                      |
| Deleted codes kept and restorable                                         | `qr_code.deleted_at`, Undo (HEY-199)                                                                           |
| Single QR, Static Packs, Print Pack, plans, trial, cancellation, plan end | `messages/en.json` `payment`, `pricing`, `plans`, `trial`; `src/server/billing/*`; `docs/LINK_AVAILABILITY.md` |
| Refunds remove what they unlocked                                         | HEY-100 refund handling (`refund` table, `src/server/billing`)                                                 |
| Reports and take-downs                                                    | HEY-182 `src/server/qr/moderation.ts`, `pnpm moderation`                                                       |
| Short links at `www.heyqr.me/r/…`                                         | `docs/LAUNCH_DOMAIN.md`, `NEXT_PUBLIC_SHORT_LINK_BASE` rule                                                    |

## Translations

The policy text exists in **English only**; no translation exists or is approved. In the other 20 locales the page
chrome (title, banner, dates, section navigation) is translated and the page says “This policy is available in
English only for now”, then shows the English text marked `lang="en"`. The text is kept out of `messages/*.json` on
purpose, so it is never machine-translated without review.
