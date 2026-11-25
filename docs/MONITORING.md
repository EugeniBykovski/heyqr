# Monitoring critical failures

HEY-175 / QR-24.01. Unexpected failures of navigation, payment, paid files and public QR access go to Sentry
(`@sentry/nextjs`, errors only). Without a DSN nothing is sent and the app behaves the same.

## Variables

| Variable                                                       | Needed | What                                                                                    |
| -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                                                   | Launch | Server failures. Read at run time.                                                      |
| `NEXT_PUBLIC_SENTRY_DSN`                                       | Launch | Browser failures. Inlined at **build** time; public by design (it only accepts events). |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`                         | No     | Default: the app environment (`APP_ENV` / `VERCEL_ENV`) and `VERCEL_GIT_COMMIT_SHA`.    |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_RELEASE` | No     | Browser overrides; `next.config.ts` defaults them to the server's values at build time. |

Set the two DSNs in Vercel per scope (Production and Preview), preferably a Sentry project per environment.

## What is reported

| Flow                        | Operation (`operation` tag)                                                               | `alert`                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Checkout creation           | `checkout.create`, `.create_pack`, `.create_plan`, `.create_print_pack`; `billing.portal` | critical (also a Stripe Price that differs from the catalog)              |
| Webhook fulfillment         | `stripe.webhook.fulfill`                                                                  | critical                                                                  |
| Paid but not granted        | `billing.paid_not_granted`, `billing.subscription_not_applied`                            | critical; low for `slot_full` and a refunded order's late payment         |
| Refund recorded for review  | `billing.refund_review`                                                                   | high                                                                      |
| Renewal `past_due`/`unpaid` | `billing.renewal_unpaid`                                                                  | low (LINK_AVAILABILITY.md 3a, 3b: Stripe retries, published access rules) |
| Webhook signature           | `stripe.webhook.signature`                                                                | low (alert on frequency: a run of them means a wrong secret)              |
| Paid files                  | `export.authorize`, `export.deliver`, `api.*.export`                                      | high                                                                      |
| Public QR                   | `qr.resolve`, `qr.redirect`, `qr.page`, `qr.hosted_file`                                  | high; `qr.scan.record` low                                                |
| Pages                       | `page.render`, `navigation.load` (browser), `request.*` (server)                          | high on editor, dashboard, export, print, checkout return; else low       |
| External probe              | `probe.short_link` ([SHORT_LINK_PROBE.md](SHORT_LINK_PROBE.md))                           | high                                                                      |
| API limiter unavailable     | `api.rate_limit` (the API answers 500; a 429 is routine and not reported)                 | high                                                                      |
| Checkout return check       | `checkout.return_check`                                                                   | high                                                                      |
| Uncaught browser errors     | `browser.unhandled`                                                                       | low                                                                       |

Never reported: cancelled Checkout, 401 / 402 / 403 / 404 / 422, unknown, paused, deleted or inactive QR codes,
repeated or unpaid webhook deliveries, redirects. A server page failure alerts once, from the server; the browser's copy
is low and shares its `correlation_id`.

Each event has `environment`, `release`, `route` (template), `operation`, `alert`, `correlation_id` and, where known,
`step` (`stripe.session_create`, `webhook.claim`, `storage.put`, …), `error_code` (PostgreSQL or Stripe), `event_type`.
The correlation id is the Vercel request id, the Stripe event id (`evt_…`) or the error digest, otherwise generated; it
is also in the server log (`[monitor] … ref=…`) and, for pages, on the error screen. Repeats group by operation, step,
route and error name; every occurrence still counts, so frequency alerts work during an outage.

**Not seen:** when a navigation's data request fails, Next.js falls back to a full page load and nothing is raised; the
server side of that failure is reported if it reached the server.

## What is never sent

`src/shared/lib/monitoring/sanitize.ts` rebuilds every event from an allowlist and drops the event if that fails:
cookies, headers, bodies, queries, users, IP addresses, `extra`, local variables, source lines, host names, and console,
fetch and click breadcrumbs don't exist in what is sent. Messages are scrubbed of URLs other than HeyQR's route
templates, failed-query parameters, quoted values, Stripe ids and keys, API keys, emails, tokens and QR payloads.

## Adding a report

Server: `reportFailure` / `reportAndRethrow` (`src/server/monitoring.ts`), steps with `step()`
(`src/server/monitoring-step.ts`). Report after the outcome is decided, rethrow the same error, never await it.
A new route's static segments go in `routes.ts` (a test fails until they do).

## Verifying before launch

1. `pnpm vitest run src/server/monitoring.test.ts src/shared/lib/monitoring` (real SDK, test transport).
2. With the DSNs of the **dev** Sentry project set, against a throw-away local database (`pnpm build && pnpm start`):
   - webhook: `alter table webhook_event rename to webhook_event_x`, send a signed event (`stripe trigger
checkout.session.completed` with `pnpm stripe:listen`): 500, one critical issue. Rename back and resend: 200.
   - public QR: the same with `qr_code`, open `/r/<code>`: 500, one high issue.
   - navigation: block a `/create` chunk in the browser's network tools, then go to it from Pricing: the error page
     with a reference, one `navigation.load` issue.
   - cancel a Checkout and open a paused code: no events.
3. Open one event of each and check the tags above and that its JSON (Sentry → event → JSON) has no query, cookie, email,
   address, code or payment value.
4. Sentry project: turn on **Data Scrubbing** and **Prevent Storing of IP Addresses**, and add the alert rules:
   `alert:critical` → page, on every new issue, regression, and any event; `alert:high` → channel, on new issue,
   regression or ≥ 5 events in 10 minutes; `alert:low` → none, except `operation:stripe.webhook.signature`
   ≥ 10 in 1 hour. Confirm that one test event reaches each destination.
5. Repeat one controlled failure on a Preview deployment: it also checks delivery from a Vercel function
   (`waitUntil`), which local runs can't.
