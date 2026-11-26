# Environments: dev and production

HeyQR runs as one of two application environments, **dev** and **production**, selected by `APP_ENV`. Automated tests
use an isolated `test` database as a fixture; that's a database target, not a third app environment.

| Where it runs                      | `APP_ENV`  | `NODE_ENV`  | Database                          | Integrations                                |
| ---------------------------------- | ---------- | ----------- | --------------------------------- | ------------------------------------------- |
| `pnpm dev` on your machine         | dev        | development | local Postgres `heyqr`            | optional; Stripe test mode, own credentials |
| Hosted dev (Vercel **Preview**)    | dev        | production  | Neon **dev** branch               | dev credentials, Stripe test mode           |
| Production (Vercel **Production**) | production | production  | Neon **production** branch        | all required, Stripe live mode              |
| `pnpm test:db`, CI `database` job  | (not used) | test        | `*_test` database, reset by tests | none                                        |

## Selecting the environment

`src/shared/config/app-env.ts` resolves it the same way for the app, the database commands and the workflows:

1. `APP_ENV` if set (`dev` or `production`);
2. otherwise Vercel's `VERCEL_ENV`: **Production → production**, **Preview → dev**, **Development** (`vercel dev`) → dev;
3. otherwise `dev`.

If `APP_ENV` and `VERCEL_ENV` disagree (for example `APP_ENV=production` in Vercel's Preview scope), startup and every
`db:*` command stop with an error that names both.

`NODE_ENV` is left to Next.js: `next dev` sets `development`, `next build`/`next start` set `production`. A hosted dev
deployment therefore runs an optimised production build with `APP_ENV=dev`. Never use `NODE_ENV` to tell dev from
production.

The database target (`src/server/db/target.ts`) is the app environment, except that tests use `test` (the test runner
sets `NODE_ENV=test`; CI's database job sets `DATABASE_TARGET=test`, the only value that variable accepts). `test`
is refused on Vercel. The HEY-7 values `local` and `preview` are now `APP_ENV=dev`; using them reports that.

## Variables

Validated in `src/env.ts` (formats) and `src/shared/config/env-rules.ts` (rules per environment). Errors list
variable names and the environment, never values. Database commands validate only what they use
(`src/server/db/target.ts`), so `pnpm db:migrate` doesn't need Stripe keys.

| Variable                                                         | Kind   | dev                                                           | production                                |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------- | ----------------------------------------- |
| `APP_ENV`                                                        | server | optional (`dev`)                                              | optional on Vercel (`production`)         |
| `DATABASE_URL`                                                   | secret | required: local Postgres or Neon dev branch (pooled)          | required: Neon production branch (pooled) |
| `DATABASE_URL_UNPOOLED`                                          | secret | Neon dev branch (direct); optional locally                    | Neon production branch (direct)           |
| `BETTER_AUTH_SECRET`                                             | secret | required, its own value                                       | required, its own value                   |
| `BETTER_AUTH_URL`                                                | server | required, same origin as `NEXT_PUBLIC_APP_URL`                | required, public `https://`               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                      | secret | required: dev OAuth client                                    | required: production OAuth client         |
| `STRIPE_SECRET_KEY`                                              | secret | optional, all-or-nothing, **`sk_test_…`**                     | required, **`sk_live_…`**                 |
| `STRIPE_WEBHOOK_SECRET`                                          | secret | with Stripe: CLI or dev endpoint secret                       | required: production endpoint secret      |
| `STRIPE_PRICE_STATIC`, `STRIPE_PRICE_DYNAMIC_MONTHLY`            | server | with Stripe: test-mode price IDs                              | required: live-mode price IDs             |
| `RESEND_API_KEY`                                                 | secret | optional, all-or-nothing; receipts are skipped without it     | required                                  |
| `EMAIL_FROM`                                                     | server | with Resend: `HeyQR <onboarding@resend.dev>` (own inbox)      | required: verified production sender      |
| `SUPPORT_EMAIL`                                                  | server | optional; leave empty until confirmed (nothing is shown)      | required: the confirmed support contact   |
| `S3_REGION`, `S3_BUCKET`                                         | server | optional, all-or-nothing: local MinIO or a private dev bucket | required: private production bucket       |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                       | secret | with storage                                                  | required                                  |
| `S3_ENDPOINT`                                                    | server | MinIO / R2 endpoint; empty for AWS                            | R2 endpoint, or empty for AWS             |
| `DYNAMIC_ACTIVE_CODE_LIMIT`                                      | server | optional (10)                                                 | optional (10)                             |
| `NEXT_PUBLIC_APP_URL`                                            | public | `http://localhost:3000` or the dev domain                     | the production domain, `https://`         |
| `NEXT_PUBLIC_SHORT_LINK_BASE`                                    | public | `http://localhost:3000/r` or the dev domain `/r`              | `{NEXT_PUBLIC_APP_URL}/r` (enforced)      |
| `API_RATE_LIMIT_PER_MINUTE`, `API_RATE_LIMIT_EXPORTS_PER_MINUTE` | server | optional (120, 30)                                            | optional (120, 30)                        |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN`                              | secret | not used yet                                                  | not used yet                              |
| `TEST_DATABASE_URL`, `DATABASE_TARGET=test`                      | test   | tests and CI only                                             | never                                     |
| `CONFIRM_PRODUCTION_MIGRATION`                                   | script | never                                                         | `1` only for a production `db:migrate`    |
| `SKIP_ENV_VALIDATION`                                            | CI     | CI build without secrets only                                 | never                                     |

**secret**: credential, server-only. **server**: server-only, not secret. **public**: `NEXT_PUBLIC_*`, visible to
anyone.

### Server-only vs public

Only `NEXT_PUBLIC_*` variables reach the browser; `@t3-oss/env-nextjs` throws if client code reads a server variable,
and server values are never inlined. `NEXT_PUBLIC_*` values are inlined **when the app is built**, so each environment
must build with its own values. Vercel does this per scope; a build copied from one scope to another keeps the first
scope's public URLs and prices.

### Integrations in dev

Payments, email and storage are optional in dev so the editor and sign-in work with just a database and Google.
Each is all-or-nothing: setting some of its variables makes the rest required. Without them:

- checkout and the billing portal fail with "Payments (Stripe) is not configured for APP_ENV=dev: set …" in the
  server log, and the webhook answers 503;
- purchase receipts are skipped with a log line;
- logo upload answers 503 `storage_not_configured`.

In production every integration is required at startup.

## Hosting: Vercel scopes

| Vercel scope    | HeyQR environment | Deploys                          | Domain                                                                  |
| --------------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------- |
| **Production**  | production        | `main`                           | `https://www.heyqr.me` (short links `https://www.heyqr.me/r`)           |
| **Preview**     | dev               | every other branch and PR        | stable dev domain on a `dev` branch (e.g. `dev.heyqr.me`) + per-PR URLs |
| **Development** | dev               | `vercel dev` / `vercel env pull` | `localhost`                                                             |

Set every variable from the table above in **both** the Preview and Production scopes, each with its own values.
Leave `APP_ENV` unset in Vercel, or set it to the matching value.

Google sign-in needs exact redirect URIs. `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` in the Preview scope therefore
point at the stable dev domain, and the dev OAuth client lists `https://dev.heyqr.me/api/auth/callback/google` and
`http://localhost:3000/api/auth/callback/google`. Per-PR preview URLs serve the app, but sign-in completes on the dev
domain.

### Per-environment services

| Service      | dev                                                                       | production                                     |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Neon         | branch `dev`                                                              | branch `main` (production)                     |
| Google OAuth | client "HeyQR dev": localhost + dev domain redirect URIs                  | client "HeyQR": production domain redirect URI |
| Better Auth  | own secret                                                                | own secret                                     |
| Stripe       | test mode: test prices, webhook `https://dev.heyqr.me/api/stripe/webhook` | live mode: live prices, production webhook     |
| Resend       | own API key, dev sender                                                   | own API key, verified production domain        |
| S3 / R2      | bucket `heyqr-dev` (or local MinIO)                                       | bucket `heyqr-prod`                            |

## Deploying and migrating

| Step               | dev                                                                      | production                                                                                           |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Migrate            | **Dev database** workflow (automatic on PRs touching the schema; manual) | **Production database** workflow (manual, type `production`)                                         |
| Seed               | Dev database workflow with "seed" ticked, or `pnpm db:seed` locally      | never (refused)                                                                                      |
| Verify             | `GET /api/health` → `"environment": "dev"`                               | `GET /api/health` → `"environment": "production"`                                                    |
| GitHub environment | `dev`: secrets `DEV_DATABASE_URL`, `DEV_DATABASE_URL_UNPOOLED`           | `production` (add required reviewers): `PRODUCTION_DATABASE_URL`, `PRODUCTION_DATABASE_URL_UNPOOLED` |

The workflow secrets are the same database URLs as the matching Vercel scope, so a deployment and its migrations
always use one database. Run migrations before the deployment that needs them.

Locally the same commands pick the environment from `.env`:

```bash
pnpm db:migrate        # dev database from DATABASE_URL
pnpm db:seed
pnpm db:verify         # prints {"target": "dev", "database": "localhost:5432/heyqr", …}
```

## One-time hosted setup (not done yet)

1. **Neon**: create a project with branches `main` (production) and `dev`.
2. **Vercel**: import the GitHub repo. Production branch `main`. Add a `dev` branch domain (e.g. `dev.heyqr.me`).
   Install the Neon integration with the Preview scope on the `dev` branch and the Production scope on `main`, or enter
   `DATABASE_URL` and `DATABASE_URL_UNPOOLED` per scope by hand.
3. **Vercel → Settings → Environment Variables**: enter the variables above for Preview (dev values) and Production
   (production values).
4. **Google, Stripe, Resend, S3**: create the per-environment clients, keys, webhooks and buckets from the table.
5. **GitHub → Settings → Environments**: create `dev` and `production` with the database secrets (the HEY-7
   `preview` environment can be deleted). Add required reviewers to `production`.
6. Run **Actions → Dev database** with "seed" ticked, then open `https://dev.heyqr.me/api/health`.

Production domain, OAuth, Stripe and DNS settings: [LAUNCH_DOMAIN.md](LAUNCH_DOMAIN.md).
