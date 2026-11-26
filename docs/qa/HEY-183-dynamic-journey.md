# HEY-183 · Dynamic Website QR from the homepage to a destination change

Branch `fix/HEY-183-dynamic-journey`, base `2e5d75f` (main). Run on 2026-11-26 against a production build of that base
on `localhost:3195`: `APP_ENV=dev`, its own throw-away PostgreSQL database (22 of 22 migrations), Stripe **test mode**
(`sk_test_…`, every session and charge `livemode: false`) with the Stripe CLI forwarding signed webhooks, private storage
on `scripts/qa/fake-s3.mjs`. Script: `scripts/qa/dynamic-journey.mjs`. The Jira issue couldn't be read (the Atlassian
connector has no access to that site), so this follows the request's acceptance text.

**Not run on a deployed Preview:** the Preview deployments fail (Vercel's Preview environment variables aren't set) and
the Vercel CLI isn't signed in here. The script is ready for one; see the end.

## Genuine and fixture

| Step                                              | How it ran                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage, Type → Dynamic, Content, Design, Export | Genuine browser flow                                                                                                                                                |
| Google consent redirect                           | **Genuine up to Google:** the configured `client_id`, `redirect_uri={BASE}/api/auth/callback/google`, code flow, `openid email profile`, `state`                    |
| Completing Google sign-in                         | **Fixture:** the account Google would create is written as Better Auth writes it; the browser continues to the app's own `callbackURL`. Genuine end to end: NOT RUN |
| Subscribe (Starter), webhooks                     | **Genuine Stripe test mode:** real Checkout, card 4242, signed `checkout.session.completed` and `customer.subscription.created`                                     |
| Trial                                             | Genuine product flow (Trial & usage → Start 7-day free trial → Export → Use your free trial)                                                                        |
| API keys for the API checks                       | Fixture rows, stored the way `keys.ts` stores a key                                                                                                                 |
| Destinations A and B                              | `https://example.com/?heyqr=<run>-A` / `-B`: a real site, told apart by the query                                                                                   |

## Results

| Account            | Engine · viewport   | Activation                                                                                | Result     |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| A (`starterA`)     | Chromium 156 · 1440 | Starter $9.00/month: `sub_1Ug1RiF0rhTjr7bDaAOoNRER`, charge `ch_3Ug1RhF0rhTjr7bD1ILFw7oo` | 10/10 PASS |
| B (`trialB`)       | WebKit 27.2 · 390   | 7-day trial, no card: no Checkout, order or charge                                        | 10/10 PASS |
| extra (`starterC`) | Firefox 157 · 834   | Starter: `sub_1Ug1SKF0rhTjr7bDxBl5PCOG`                                                   | 10/10 PASS |

Each run, one fresh account, signed out at the start:

1. **Homepage → editor:** the hero's Website address (A) and Forest color, More + → Type with Website preselected →
   "Yes, I may change it" (Dynamic) → Content shows A → Design → Export, PNG 600 dpi. Nothing is saved before sign-in.
2. **Sign-in keeps everything:** one code, `model=dynamic`, `destination=A`, the Forest color, and `format=png&res=600` on
   the return; no short code and not active yet.
3. **Activation from the server's state:** Starter: with the webhook held back the return shows "Confirming your
   payment…" and the code has no short code; once the held events are delivered, one active `starter` subscription
   (limit 5) and one $9.00 charge. Trial: `trial_started_at` set, the code is the trial's test code (`is_trial`). In both
   the code becomes `active` with a permanent short code.
4. **Before the change:** the downloaded PNG decodes (ZXing) to the short link; a signed-out request gets `302` to A
   with `Cache-Control: no-store`, and a signed-out browser lands on A.

   | Account | Short link (decoded from the file) | Before → A                              |
   | ------- | ---------------------------------- | --------------------------------------- |
   | A       | `http://localhost:3195/r/9bHcjaH`  | `https://example.com/?heyqr=starterA-A` |
   | B       | `http://localhost:3195/r/3TRvJsZ`  | `https://example.com/?heyqr=trialB-A`   |

5. **Change destination to B** on QR details; "Saved", and B is shown and stored after a reload.
6. **After the change:** the **original** file still decodes to the same short link, which now answers `302` to B
   (`…starterA-B`, `…trialB-B`). A browser that had followed it to A before lands on B. 8 repeated requests: all B.
   Codes 1, the same single short code, orders 0, Checkout Sessions unchanged (1 for Starter, 0 for the trial).
7. **Invalid destination:** "not a website" in the form → "Web addresses can’t contain spaces.", nothing stored;
   `PATCH /api/v1/…/destination` with `javascript:alert(1)` → 422; the link still goes to B.
8. **Another account:** QR details shows "Page not found" without the destination (HTTP 200, the app-wide loading
   page, as noted in HEY-182); API v1 GET and PATCH → 404; the destination and the redirect are unchanged.

**Defects:** none found in these flows. Observed, not changed: Export for a signed-in account whose trial hasn't started
offers only Subscribe; the trial is started from Trial & usage (the homepage's "Start 7-day free trial").

## Running it against a Preview

The script refuses a target whose `/api/health` isn't `dev` and any Stripe key that isn't `sk_test_`. Against a deployed
Preview (Stripe's own test webhook delivers the events, so nothing is held back):

```bash
BASE=https://<preview-host> \
QA_DATABASE_URL="<the Preview's Neon branch, direct connection>" \
BETTER_AUTH_SECRET="<the Preview's secret>" GOOGLE_CLIENT_ID="<the Preview's client id>" \
STRIPE_SECRET_KEY="<the Preview's sk_test_ key>" M=/tmp/hey183 \
node scripts/qa/dynamic-journey.mjs chromium 1440 starter
# second fresh account: … webkit 390 trial
```

A Vercel Preview behind Deployment Protection also needs its bypass token (not handled by the script).
