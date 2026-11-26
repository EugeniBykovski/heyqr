# HEY-193 · Event QR, Terms and Privacy, design pages 2 / 3 / 5 / 6, acceptance on one commit

Branch `feat/HEY-193-event-legal-ui`, base `66bcab3` (main; HEY-182 to HEY-192 merged), accepted commit `6561714`. Run on
2026-11-26. Jira HEY-193 couldn't be read (the Atlassian connector has no access to that site), so acceptance follows
the request text; "the original Content / Event board" is design board 1.14 plus the Developer handoff. Design version
1795719958-e489.

## Pages and boards

| Link | Page                    | Boards   |
| ---- | ----------------------- | -------- |
| 1    | 2 · Branded, end to end | 2.1–2.11 |
| 2    | 3 · Export & purchase   | 3.1–3.11 |
| 3    | 5 · Loading             | 5.1–5.4  |
| 4    | 6 · Signed-in home      | 6.1, 6.2 |

## Environment

Production build of `6561714` on `localhost:3211`, `APP_ENV=dev`, its own local PostgreSQL database (22 migrations, dev
seed), private storage on `scripts/qa/fake-s3.mjs`, Stripe **test mode** with signed webhooks from the Stripe CLI.

## Critical checks

| Check                                                                                                                                                          | Result                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Lint (0 errors), typecheck, `pnpm test` (1,190 incl. 22 catalog checks), `pnpm test:db` (243), build                                                           | PASS                                                                      |
| Event: required name and date, real dates, end after start, end needs a start; focus on the first problem                                                      | PASS (Chromium, WebKit 390 / 834 / 1440, Firefox 1440)                    |
| Event: live After scanning preview, draft kept across steps, Back and reload, reopen when signed in                                                            | PASS                                                                      |
| Event: real exported PNG and SVG decode (ZXing) to the VEVENT with Unicode and punctuation intact                                                              | PASS                                                                      |
| Event: ical.js imports 19:00 on the event's date in Tokyo, Los Angeles, Warsaw and UTC (floating time); all-day ends next day                                  | PASS (unit)                                                               |
| Terms and Privacy: canonical `/terms`, `/privacy`, DRAFT banner, noindex, section nav, keyboard focus, footer and sign-in links, English-only notice in German | PASS                                                                      |
| Page 2: branded looks; paid branded PNG pixel-identical to the saved layout, decodes to the input; download again 1/1/1                                        | PASS (3 runs: Chromium 1440 ×2, WebKit 390)                               |
| Page 3: guest → sign-in → Checkout → confirming → preparing → downloaded → download again                                                                      | PASS 8/8 (WebKit 390)                                                     |
| Page 3: cancel → not charged, draft kept, Pay again (2 sessions, 0 charges)                                                                                    | PASS 5/5 (Chromium 1440)                                                  |
| Page 3: storage failure → error + Try again → same purchase (1 order, 1 session, 1 charge); other account 404                                                  | PASS 6/6 (WebKit 390)                                                     |
| Page 5: skeletons and progress on real route and request lifecycles, controlled delays to success, empty and error                                             | PASS 8/8 × 7 runs (with page 6)                                           |
| Page 6: signed-in home with codes (6.1) and new account (6.2), counts match the database                                                                       | PASS                                                                      |
| Genuine Google OAuth sign-in                                                                                                                                   | NOT RUN: needs a person (redirect to Google's consent was genuine)        |
| Physical phone scans and import into a calendar app                                                                                                            | NOT RUN                                                                   |
| Deployed Preview                                                                                                                                               | NOT RUN: Preview deployments fail (env not set); Vercel CLI not signed in |

## Defect found in this run

Back from Google sign-in, the editor continued to Export only if the restored draft's scan check had already passed
when its effect ran. The check renders deferred (HEY-41), so on a slow render (the branded artwork look, 1 run in 3) it
gave up and never ran again: the person stayed on Design. Fixed in `6561714` (`use-auto-resume.ts`, with a test that
fails on the old behaviour). After the fix all three branded runs passed.

## Legal review

The policy text is a draft from a code and configuration audit, English only, outside the message catalogs. Open items
for the owner or a lawyer are in [docs/legal/REVIEW.md](../legal/REVIEW.md) (legal entity, contact, refunds and the
withdrawal right, legal bases, retention, transfers, governing law, and two product gaps: no self-service account
deletion or export, stored Google tokens). No policy translation exists or is approved; other locales show an explicit
English-only notice. Publication needs separate approval.
