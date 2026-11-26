# HEY-185 · Cancellation and reactivation of a Starter subscription

Branch `fix/HEY-185-subscription-lifecycle`, base `c20f19c`. Run on 2026-11-26 against a production build (`next build` +
`next start`) of that base on `localhost:3202`. Jira HEY-185 couldn't be read (the Atlassian connector has no access to
that site), so this follows the request text. The rules it checks: [LINK_AVAILABILITY.md](../LINK_AVAILABILITY.md),
"Cancelling, undoing and subscribing again".

- **Environment:** `APP_ENV=dev`, its own PostgreSQL database (`heyqr_hey185_life`, 22 of 22 migrations), private storage
  on `scripts/qa/fake-s3.mjs`. **Not a deployed Preview** (Preview builds fail: their Vercel env isn't set, and the
  Vercel CLI isn't signed in).
- **Stripe:** test mode ("Sandbox"; every subscription, invoice and charge `livemode: false`). The Stripe CLI forwarded
  signed webhooks. The Customer Portal is the account's default configuration: cancel **at period end**, reasons on.
- **Script:** `scripts/qa/subscription-lifecycle.mjs <engine> <width> <undo|expire>`.

## Genuine and fixture

| Step                                                                               | How it ran                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage → Dynamic Website → Export, Subscribe, Manage subscription, Choose a plan | Genuine browser flow                                                                                                                                                             |
| Google sign-in                                                                     | Genuine up to Google's consent (client, `redirect_uri` = the app's callback, state); completion as **fixture** rows written as Better Auth does                                  |
| Checkout, Customer Portal (cancel, "Don't cancel subscription"), webhooks          | **Genuine Stripe test mode**                                                                                                                                                     |
| Account B's Stripe Customer on a **test clock**                                    | **Fixture setup:** the Customer was created on a Stripe test clock and bound in `user.stripe_customer_id` before the first Checkout, the way the app binds one                   |
| Period end for account B                                                           | Genuine: the test clock advanced past the period end; Stripe ended the subscription itself                                                                                       |
| Account B's extra codes                                                            | Draft rows copied from the first code (**fixture**), then activated (Go live), paused (QR details), deleted (My QR codes) and taken down (`pnpm moderation`) through the product |

## Results (each run one fresh account, signed out at the start)

| Account                               | Engine · viewport   | Result |
| ------------------------------------- | ------------------- | ------ |
| A · schedule, then undo               | Chromium 156 · 1440 | 10/10  |
| B · schedule, period ends, reactivate | WebKit 27.2 · 390   | 15/15  |

**Account A** (`sub_1Ug3m0F0rhTjr7bDKVWePof7`, charge `ch_3Ug3lzF0rhTjr7bD0kW8Sbg0` $9.00):

- Short link decoded from the downloaded PNG: `/r/xM3FDGw` → 302 to destination A for a signed-out visitor.
- Portal → Cancel subscription: stored `active`, scheduled; Stripe's cutoff 2026-12-26T14:35:43Z; Plan & billing
  **"Cancels" · "Ends on Dec 26, 2026"**. Before the cutoff the file answers 200 and the link still goes to A.
- Portal → "Don't cancel subscription": the same subscription, active, not cancelling; subscriptions 1, invoices 1,
  charges 1 (unchanged); Plan & billing **"Renews on Dec 26, 2026"**; the link still goes to A.
- Resending the cancellation event (`evt_1Ug3mEF0rhTjr7bDk6HBsguU`) after the undo changes nothing.

**Account B** (test clock `clock_1Ug3miF0rhTjr7bDUzEnOsAZ`, `sub_1Ug3mtF0rhTjr7bDevdeJPuk`):

- Short link `/r/sadTNtj` → A. Three more codes went live, then were paused, deleted and taken down: each answers
  `link-unavailable`.
- Cancellation scheduled: **"Ends on Dec 26, 2026"** (cutoff 2026-12-26T14:36:28Z); file 200, link → A.
- Clock advanced to 2026-12-28T14:36:28Z: Stripe sent **`customer.subscription.deleted` `evt_1Ug3nVF0rhTjr7bDT4bLMrk9`**;
  stored `canceled`; Plan & billing **"No plan"**; the link answers 302 → `/link-unavailable?reason=inactive` (no owner
  data on the page); the file answers 402; the code keeps `active`, short code `sadTNtj` and destination A.
- Choose a plan → Subscribe (test Checkout): new **`sub_1Ug3njF0rhTjr7bDyDWKF75l`** active, the old one stays
  `canceled`; Plan & billing **"Renews on Jan 28, 2027"** (test-clock time); the **original file** decodes to the same
  `/r/sadTNtj`, which redirects to A again.
- Resending an old "active" update of the ended subscription (`evt_1Ug3nMF0rhTjr7bDjifegBzb`): it stays canceled, one
  active subscription.
- The paused, deleted and taken-down codes stay unavailable after the reactivation (`paused`; `deleted_at` set;
  `taken_down_at` set).

**Both:** another account sees "No plan" and no Manage subscription; signed out, Plan & billing redirects to sign-in and
its HTML holds none of the account's data.

## Defects

None found in the product. New regression coverage: the PostgreSQL test "reactivation after a plan ended keeps pauses,
deletions and takedowns" (scheduled → ended → new subscription, with a late event of the old one).

## Contradictions (recorded in LINK_AVAILABILITY.md, Missing decisions 5–6)

- The Commerce handoff says plan end **pauses** Dynamic codes (the "link paused" page, `dynamic_active` −1). The product
  keeps their status, shows the neutral "not active" page, and brings them back with a new plan, as Pricing and the
  trial copy promise.
- Undo of a scheduled cancellation exists only in Stripe's Portal; Plan & billing has no Resume button of its own.

## Not run

- A deployed Preview with an isolated Neon branch (Vercel CLI not signed in; Preview env not set).
- Genuine Google OAuth end to end (needs a person).
- Live Stripe.

## On a Preview

```
BASE=https://<preview> QA_DATABASE_URL=<Preview Neon branch, direct> BETTER_AUTH_SECRET=<Preview> \
GOOGLE_CLIENT_ID=<Preview> STRIPE_SECRET_KEY=<sk_test_…> M=<out> PLAYWRIGHT_CORE=<playwright-core index.mjs> \
node scripts/qa/subscription-lifecycle.mjs chromium 1440 undo
# then, for the second fresh account:
node scripts/qa/subscription-lifecycle.mjs webkit 390 expire
```

Stripe's webhook endpoint for that Preview must include `customer.subscription.*` and `checkout.session.*`. A protected
Preview also needs Vercel's bypass token.
