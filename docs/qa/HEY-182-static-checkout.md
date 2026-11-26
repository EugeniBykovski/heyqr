# HEY-182 · Static QR from guest to repeat download

Branch `fix/HEY-182-static-checkout`, base `a0d84be`. Run on 2026-11-26 against a production build (`next build` +
`next start`) of that base on `localhost:3193`.

- **Environment:** `APP_ENV=dev`, its own throw-away PostgreSQL database (`heyqr_hey182_checkout`, 21 of 21 migrations).
- **Stripe:** test mode (`sk_test_…`, Checkout shows "Sandbox", every session and payment intent has `livemode: false`). The
  Stripe CLI forwarded signed webhooks to `/api/stripe/webhook`.
- **Storage:** the app's private-storage path (`S3_ENDPOINT`) pointed at `scripts/qa/fake-s3.mjs`, so paid files went through
  "store once, then a short-lived signed link" exactly as with R2.
- **Script:** `scripts/qa/static-checkout.mjs`. Every downloaded file was decoded with ZXing (`scripts/qa/decode-file.ts`,
  `@heyqr/qr-core/verify`) and compared with the typed address.
- The Jira issue itself couldn't be read (the Atlassian connector has no access to that site), so this follows the
  acceptance text of the request.

## What is genuine and what is a fixture

| Step                                       | How it ran                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest editor, Export, Continue with Google | Genuine browser flow.                                                                                                                                                                                                                                                                                                                                            |
| Google consent redirect                    | **Genuine up to Google.** `/api/auth/sign-in/social` answered with a real `accounts.google.com/o/oauth2/v2/auth` URL: the configured `client_id`, `redirect_uri=http://localhost:3193/api/auth/callback/google` (the app's Better Auth callback route), `response_type=code`, `scope` with `openid email profile`, and a `state`. The browser was stopped there. |
| Completing Google sign-in                  | **Fixture.** Signing in to Google needs a person. The account Google would have created was written as Better Auth writes it (`user`, `account` with `provider_id=google`, `session`), and the browser went on to the `callbackURL` the app had sent (`/create?resume=1&format=png&res=4`). **Genuine Google OAuth end to end: NOT RUN.**                        |
| Checkout, payment, webhook, unlock         | **Genuine Stripe test mode:** real Checkout pages, test cards, signed webhooks.                                                                                                                                                                                                                                                                                  |
| Export-preparation failure                 | Caused at the storage boundary: the QA S3 answered 500 to every attempt of one PUT (3, the S3 client's retry count). No switch was added to the app.                                                                                                                                                                                                             |

## Results

Each run was one fresh account, starting signed out.

| Run | Engine · viewport   | Scenario                                        | Result   |
| --- | ------------------- | ----------------------------------------------- | -------- |
| A   | Chromium 156 · 1440 | guest → paid → repeat                           | 8/8 PASS |
| B   | WebKit 27.2 · 390   | guest → paid → repeat                           | 8/8 PASS |
| C   | Firefox 157 · 834   | guest → paid → repeat                           | 8/8 PASS |
| D   | Chromium 156 · 1440 | cancel → resume                                 | 5/5 PASS |
| E   | WebKit 27.2 · 390   | cancel → resume                                 | 5/5 PASS |
| F   | Chromium 156 · 1440 | paid → preparation fails → retry, other account | 6/6 PASS |
| G   | WebKit 27.2 · 390   | paid → preparation fails → retry, other account | 6/6 PASS |

### Guest to repeat download (A, B, C)

1. **The draft survives sign-in.**
   - As a guest: a Website code (`https://qa182-<run>.example/landing?src=print`), Custom design with the Dots pattern and
     the Forest color, Export with PNG 4×. No code is saved before sign-in.
   - After sign-in: exactly one code is saved for the new account, with that content, the Dots pattern and the Forest
     color.
   - The export screen opens with `format=png&res=4` and 4× selected. The file answers 402 and Pay $4.99 is shown.
2. **Payment is confirmed by the server, not by the return URL.**
   - The webhook was held back: the listener was stopped before paying.
   - Back from Checkout (`checkout=success`), the screen shows "Confirming your payment…". It stayed that way, the file
     stayed 402 and no order was paid.
   - The listener was started again and the real `checkout.session.completed` event was resent (A
     `evt_1Ug0PjF0rhTjr7bDpq2h8Sfl`, B `evt_1Ug0QhF0rhTjr7bD5r3GHO1d`, C `evt_1Ug0WOF0rhTjr7bDPFrUv9Qu`).
   - Only then did the screen move on to "Preparing your PNG…" (storage held 5 s to show it) and Download.
3. **Exactly one paid order and one charge.**
   - The database has one paid order of $4.99 USD.
   - Stripe has one Checkout Session and one succeeded payment intent for the account, both test mode.
4. **The downloaded file is correct.** The PNG (212–230 KB, 2048 px) decodes to exactly the typed address in all three runs.
5. **Access persists.**
   - After a reload, Pay is not offered.
   - In a new browser context with a new session, Pay is not offered and the file is prepared with a 200.
6. **A repeat download is free.**
   - The route was My QR codes → the code → "Download PNG of QR only" → Download.
   - The second file decodes to the same address.
   - Before and after: 1 order, 1 Checkout Session, 1 charge.

### Cancellation (D, E)

- **Cancelling keeps everything.**
  - "Back to HeyQR" on Checkout returns to `checkout=cancelled` with the same `qr`, `layout` and `res=4`, and the notice
    "You weren’t charged".
  - The file still answers 402, no order is paid, Stripe shows no charge, and the saved design is still Dots.
- **Resuming works without a double-charge risk.**
  - Pay again opens a new Checkout for the same code.
  - Stripe then holds one `open` session and the first one `expired`: the server expires the previous attempt before
    creating the next (`single-order.ts`), so two payable sessions never exist.
  - The single pending order is reused, and there are 0 charges.

### Preparation failure and retry (F, G)

- **The failure is shown, and the payment is safe.**
  - The payment with 4242 went through. The automatic preparation then failed: 3 storage PUTs answered 500 for this code,
    which is one whole request after the S3 client's own retries.
  - The screen shows "We couldn’t prepare your PNG. Your payment and settings are safe. Try again in a moment." with Try
    again. The order is already paid.
  - A single failed PUT is absorbed by the client's retry, so a user never sees it.
- **Try again uses the same purchase.**
  - The file is prepared and downloaded, and decodes to the typed address.
  - Before and after: 1 order, 1 Checkout Session, 1 charge.
- **Another account gets nothing.**
  - A second fresh account gets 404 from every file route: `/api/export/<layout>`, with `qr`, with `prepare=1`, and
    `/api/export/all/<qr>`.
  - Its export page and code page show "Page not found" and contain none of the code's content.
  - Signed out, the file route answers 401.

## Defects

**None confirmed in these flows; no product code changed.**

Two harness issues were fixed in the script, not the app:

- This Stripe account's Checkout now asks for the full billing address (Stripe Tax). The HEY-180 matrix's card helper
  filled only the card.
- A race in waiting for the "Download PNG" button.

Observations, not changed:

- **Page-not-found status.** A page that ends in "not found" for another account answers HTTP 200 with the not-found
  page. The app-wide `loading.tsx` streams the response before `notFound()` runs, and this happens app-wide. Nothing leaks,
  and the file routes answer real 404 / 401 / 402.

## Not run

- **Genuine Google OAuth sign-in** needs a person at Google's consent screen. Everything up to Google's consent redirect
  was genuine.
- **Live Stripe** (live keys, real cards, 3-D Secure in live mode) was not run: no live charges.
- **R2** itself was not used. The same S3 API ran against the QA store, so a signed link was served by it, not by R2.

## Reproduce

```sh
PORT=9182 node scripts/qa/fake-s3.mjs &
# the app: APP_ENV=dev, a throw-away DATABASE_URL, S3_ENDPOINT=http://localhost:9182 (S3_REGION/BUCKET/keys any),
# STRIPE_SECRET_KEY=sk_test_…, STRIPE_WEBHOOK_SECRET from `stripe listen --print-secret`; then next build && next start
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to localhost:3193/api/stripe/webhook &
node scripts/qa/static-checkout.mjs chromium 1440 fresh
node scripts/qa/static-checkout.mjs webkit 390 cancel
node scripts/qa/static-checkout.mjs webkit 390 retry
```
