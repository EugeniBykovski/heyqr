# Short link probe

HEY-176 / QR-24.02. Checks from outside the deployed app that one permanent Dynamic QR short link still works: DNS, TLS,
the platform, the app, the database and the access rules, as a scanner meets them. The check is
`scripts/short-link-probe.ts`; **Actions → Short link probe** runs it every 15 minutes on GitHub's runners.

It sends one `GET` (redirects not followed, 10 s limit, no cookies, session or API key) and passes only on HTTP 302, the
exact expected `Location` and `Cache-Control: no-store`. It is marked `x-heyqr-test: 1`
([SCAN_ANALYTICS.md](SCAN_ANALYTICS.md)), so it isn't a scan; the marker changes nothing else.

## Setting it up, per environment

1. On an internal account with a **permanent plan**, create a Dynamic **Website** code used for nothing else. Not the
   trial's test code (it stops after 7 days) and not a hosted page (its address isn't the destination). It takes one
   live slot. Name it so nobody pauses, deletes or re-points it.
2. Point it at an HTTPS address HeyQR controls and won't move. The probe never opens it. It must not be the
   unavailable page.
3. Read the exact answer once (the app may normalize the address, e.g. add a trailing `/`):
   `curl -sI -X GET -H 'x-heyqr-test: 1' <short link>` and copy `location`.
4. **GitHub → Settings → Secrets and variables → Actions**, repository level:

| Name (`_PRODUCTION` or `_DEV`)            | Kind     | Value                                                            |
| ----------------------------------------- | -------- | ---------------------------------------------------------------- |
| `SHORT_LINK_PROBE_URL_PRODUCTION`         | variable | The short link, e.g. `https://<short domain>/<slug>`             |
| `SHORT_LINK_PROBE_DESTINATION_PRODUCTION` | variable | The exact `Location`                                             |
| `SHORT_LINK_PROBE_SENTRY_DSN_PRODUCTION`  | secret   | That environment's `SENTRY_DSN` ([MONITORING.md](MONITORING.md)) |

The variables appear in this repository's public logs, so the code and destination must be safe to show. Until they are
set, scheduled runs are **skipped**, which is not a pass. The schedule runs only from the default branch.

5. In Sentry add an alert rule for `operation:probe.short_link`, **on every event** (production), to the channel of
   `alert:high`. The `alert:high` rule alone isn't enough: it fires on a new issue or 5 events in 10 minutes, and a probe
   failing every 15 minutes reaches neither after its first event.

## Running it

- **Actions → Short link probe → Run workflow**, choosing the environment. Not configured: the run fails (exit 2).
- With **drill** ticked it expects a wrong destination on purpose: the run must fail with `unexpected_target` and the
  alert must arrive (tagged `drill:true`). Do this once after setup and after changing alert rules.
- By hand, from any machine outside the app's hosting:
  `SHORT_LINK_PROBE_URL=… SHORT_LINK_PROBE_DESTINATION=… pnpm probe:short-link`
- `pnpm probe:short-link --local` takes a loopback address over http, for a local app. It says so in its output and is
  never evidence that the public link works.

`SHORT_LINK_PROBE_TIMEOUT_MS` (1–60000) changes the limit. Exit code: 0 passed, 1 failed, 2 misconfigured.

## Reading a failure

The run and the Sentry event name the kind (`step` tag), never the address that was answered. `correlation_id` is
`probe-<GitHub run id>`.

| Kind                | Meaning                                    | Look at                                                                                                                                                                                 |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unavailable_page`  | The app says the code isn't live           | "reason: inactive": the account's plan or trial. Otherwise: paused, deleted, or another database                                                                                        |
| `unexpected_target` | Redirected somewhere else                  | **Treat as urgent.** The code's destination history, then domain and redirect rules                                                                                                     |
| `status`            | Not a 302                                  | 5xx: `qr.resolve` events in Sentry, deployment, database. 301/307/308: a domain redirect or platform rule in front of the app. 401/403: deployment protection. 404: the domain or route |
| `cacheable`         | Right target, but the answer may be stored | CDN or header rules; printed codes could keep an old destination                                                                                                                        |
| `missing_location`  | 302 without a target                       | A proxy in front of the app                                                                                                                                                             |
| `timeout`           | No answer in time                          | Deployment, database connections; a single one can be a cold start or GitHub's network                                                                                                  |
| `network`           | No connection                              | The code in brackets: `ENOTFOUND` DNS, `CERT_…` certificate, `ECONNREFUSED` host                                                                                                        |

There are no retries: one failed request is one failed check. Run it again by hand to tell a blip from an outage.

**Limits.** GitHub may start scheduled runs late or drop some, and disables schedules in a public repository after 60
days without activity: a probe that stops running doesn't alert by itself. It checks one code from one region.
