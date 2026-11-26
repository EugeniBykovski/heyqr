# HEY-185 · acceptance on one commit

Branch `feat/HEY-185-account-subscription-lifecycle`, base `c20f19c` (main), accepted commit `37c7c94`. Run on
2026-11-26. Jira HEY-185 couldn't be read (the Atlassian connector has no access to that site), so acceptance follows
the request text. Rules and contradictions: [LINK_AVAILABILITY.md](../LINK_AVAILABILITY.md); journey details:
[HEY-185-subscription-lifecycle.md](HEY-185-subscription-lifecycle.md).

## Environment

Production build (`next build` + `next start`) of the accepted app code on `localhost:3203`, `APP_ENV=dev`, its own local
PostgreSQL database (22 of 22 migrations), Stripe **test mode** (Checkout, Customer Portal, test clocks) with signed
webhooks from the Stripe CLI, private storage on `scripts/qa/fake-s3.mjs`. **Not a deployed Preview:** Preview
deployments fail because their Vercel environment variables aren't set, and the Vercel CLI isn't signed in here.

## Defect found in this run

**Keep my plan failed against real Stripe.** It sent `cancel_at_period_end: false` and `cancel_at: ""` in one update;
Stripe refuses that ("Received both cancel_at_period_end and cancel_at parameters. Please pass in only one."). The DB
test's fake Stripe accepted both, so it passed there. Fixed in `b7ed5eb` (read the subscription, clear only the field
that is set: the Portal schedules with `cancel_at`), with `src/server/billing/subscriptions.test.ts`.

## Critical checks

| Check                                                                                  | Result                  | Evidence                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint (0 errors), typecheck, `pnpm test` (1,110), `pnpm test:db` (242), build           | PASS                    |                                                                                                                                                                                                              |
| Account A, Chromium 1440: subscribe, download, schedule cancel, **Keep my plan**       | PASS 10/10              | `sub_1Ug44HF0rhTjr7bDw3LyMTYG`; `/r/Fv77wbZ` → A; "Ends on Dec 26, 2026" = Stripe cutoff 2026-12-26T14:54:35Z; after Keep: same sub active, subscriptions 1, invoices 1, charges 1, "Renews on Dec 26, 2026" |
| Undo through Stripe's Portal ("Don't cancel"), Firefox 834                             | PASS 10/10              | same subscription continues, no new charge                                                                                                                                                                   |
| Account B, WebKit 390: schedule cancel, test clock past the period end, Reactivate     | PASS 15/15              | clock `clock_1Ug48MF0rhTjr7bDAiEWJhVE`; `customer.subscription.deleted` `evt_1Ug49BF0rhTjr7bDURUlbH2W`; stored `canceled`; "No plan"; `/r/jZPxp6e` → `/link-unavailable?reason=inactive`; file 402           |
| Reactivate: new subscription, the ORIGINAL file's same short link redirects to A again | PASS                    | new `sub_1Ug49MF0rhTjr7bD2KkAWkV7`, old stays canceled; "Renews on Jan 28, 2027" (clock time)                                                                                                                |
| Reactivation keeps an owner pause, a deletion and an operator takedown                 | PASS                    | all three still unavailable                                                                                                                                                                                  |
| Duplicate and stale webhooks can't regress state                                       | PASS                    | resent cancellation (A) and an old "active" update of the ended sub (B): no change                                                                                                                           |
| Owner-only billing (other account, signed out)                                         | PASS                    | other account: No plan, no Manage; signed out → sign-in                                                                                                                                                      |
| Account boards 4.1–4.12                                                                | PASS 19/19 ×7           | Chromium and WebKit at 390 / 834 / 1440, Firefox 1440                                                                                                                                                        |
| Deployed Preview run, Preview URL and deployed SHA                                     | NOT RUN                 | Preview builds fail (env not set); Vercel CLI not signed in                                                                                                                                                  |
| Genuine Google OAuth sign-in                                                           | NOT RUN                 | needs a person; the redirect to Google's consent was genuine                                                                                                                                                 |
| Live Stripe                                                                            | NOT RUN                 | outside a test run                                                                                                                                                                                           |
| `@heyqr/qr-core` / `@heyqr/sdk` from the public registry                               | NOT RUN                 | both 0.1.0 answer 404 on registry.npmjs.org (unpublished, `private`)                                                                                                                                         |
| Local tarball smoke (packages unchanged since `066c370`)                               | SDK PASS · qr-core FAIL | qr-core exports TS source; Node refuses `node_modules` type stripping                                                                                                                                        |

## Real Stripe test mode vs fixtures

- **Real (test mode):** Checkout, the Customer Portal (cancel, "Don't cancel"), Keep my plan's Stripe update, webhooks,
  test-clock expiry, the reactivation Checkout.
- **Fixture:** completing Google sign-in; Account B's Stripe Customer created on a test clock and bound before its first
  Checkout; Account B's three extra codes (draft rows copied, then paused, deleted and taken down through the product);
  the Account-board accounts, seeded in each billing state.

## Harness notes

Two runs stopped in the harness, not the app: one on a page navigation race while setting up B's extra codes, and one
because the lifecycle script still looked for "Choose a plan" where Plan & billing now offers "Reactivate Starter"
(script updated in `37c7c94`). Each rerun used a new fresh account. Three test clocks from these runs remain in the
Stripe sandbox (`clock_1Ug452F0rhTjr7bDH3iAKqCR`, `clock_1Ug46VF0rhTjr7bDX3Hs1Kqc`, `clock_1Ug48MF0rhTjr7bDAiEWJhVE`);
deleting them was not permitted from this session.

No migrations in this change.
