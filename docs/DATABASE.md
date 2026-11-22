# Database: PostgreSQL + Drizzle

The app uses PostgreSQL through Drizzle ORM and the `pg` driver (`src/server/db`). The schema lives in
`src/server/db/schema.ts`; committed SQL migrations live in `drizzle/`.

## Database targets

Every process knows which database it is pointed at (`src/server/db/target.ts`). The target is the app environment
from `APP_ENV` / `VERCEL_ENV` (see [ENVIRONMENTS.md](ENVIRONMENTS.md)), except that automated tests use `test`.

| Target       | Used by                                                    | Database                                  | Seeding | Migrating                                  |
| ------------ | ---------------------------------------------------------- | ----------------------------------------- | ------- | ------------------------------------------ |
| `dev`        | `pnpm dev` locally (default) and Vercel Preview            | local `heyqr`, or the Neon **dev** branch | yes     | yes; hosted via the Dev database workflow  |
| `production` | Vercel Production                                          | the Neon **production** branch            | never   | only with `CONFIRM_PRODUCTION_MIGRATION=1` |
| `test`       | `pnpm test:db`, CI `database` job (`DATABASE_TARGET=test`) | a database whose name ends in `_test`     | yes     | yes; tests also reset it                   |

Logs, `pnpm db:verify` and `GET /api/health` identify a database only by its target and `host:port/name`, never by
credentials.

## Environment variables

| Variable                | Required | Purpose                                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | yes      | Connection used by the app (on Neon: the **pooled** endpoint).                             |
| `DATABASE_URL_UNPOOLED` | on Neon  | Direct connection used by `pnpm db:migrate` and drizzle-kit. Falls back to `DATABASE_URL`. |
| `APP_ENV`               | no       | `dev` or `production`; selects the target. Empty locally (dev); implied on Vercel.         |
| `DATABASE_TARGET`       | tests    | Only `test`, for CI fixtures. Refused on Vercel.                                           |
| `TEST_DATABASE_URL`     | tests    | Database that `pnpm test:db` **drops and recreates**. Its name must end in `_test`.        |

Values go in `.env` locally (copied from `.env.example`), in Vercel per scope, and in the GitHub `dev` / `production`
environments for the migration workflows. Never commit them.

Why two URLs: Neon's pooler is PgBouncer in transaction mode. It is right for many short-lived serverless connections,
but it can't hold the session-level advisory lock that `pnpm db:migrate` takes, so migrations use the direct endpoint.
Local Postgres has no pooler, so one URL is enough.

The app pool (`src/server/db/index.ts`) keeps 10 connections locally. On Vercel it keeps at most 5 per function
instance and closes idle ones after 5 s, leaving the fan-in to Neon's pooler.

## Local setup

Either Postgres in Docker:

```bash
pnpm db:up                     # postgres:17 on localhost:5432, user/password/db heyqr
```

or a local install (macOS):

```bash
brew install postgresql@17 && brew services start postgresql@17
psql -d postgres -c "create role heyqr login password 'heyqr';"
psql -d postgres -c "create database heyqr owner heyqr;"
psql -d postgres -c "create database heyqr_test owner heyqr;"
```

Then:

```bash
cp .env.example .env           # DATABASE_URL and TEST_DATABASE_URL already point at the local databases
pnpm db:migrate                # apply committed migrations
pnpm db:seed                   # optional demo data: ana@example.com with 2 codes
pnpm db:verify                 # connectivity, tables and migrations
pnpm dev                       # http://localhost:3000/api/health reports the same check
```

## Changing the schema

1. Edit `src/server/db/schema.ts`.
2. `pnpm db:generate`: writes a new SQL migration to `drizzle/` and updates `drizzle/meta/`. Review the SQL.
3. `pnpm db:migrate`: applies it locally. Commit the migration together with the schema change.

`pnpm db:push` writes the schema straight to a database without a migration file. Use it only on a throw-away local
database; hosted dev and production only ever receive committed migrations.

`pnpm db:migrate` applies only the migrations the database hasn't recorded (`drizzle.__drizzle_migrations`), so it is
safe to rerun. It holds a Postgres advisory lock, so concurrent runs against the same database wait for each other.

## Design JSON versions

QR designs are stored as versioned JSON. The contract and its only readers live in `src/entities/qr/model/design-schema.ts`.

| Where                              | Shape (schemaVersion 1)                                                 | Reader             |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| `qr_layout.design` (saved variant) | `{ schemaVersion, layout, editor? }`: rendered layout + editor settings | `readLayoutRecord` |
| Browser `localStorage` guest draft | `{ schemaVersion, name, model, content, ...design settings }`           | `readDraftDesign`  |

- `schemaVersion` versions the JSON shape. The `:v1` in the browser key `heyqr:draft:v1` only names the storage slot.
- Records without `schemaVersion` were written before versioning. They are read as their known shape (`{ layout }`, or
  a plain editor draft) and become version 1 the next time they are saved. No database migration is needed.
- Malformed records and records from a newer `schemaVersion` are never shown with a guessed design. A saved variant is
  left out of the page and logged by id. A guest draft is kept as-is (plus a copy under `heyqr:draft:unreadable`),
  the editor starts fresh with a notice, and nothing is autosaved until the user edits.
- When the shape changes: bump `DESIGN_SCHEMA_VERSION`, keep reading the previous version, and add a test for it.

## Seeding

`pnpm db:seed` loads synthetic fixtures (`src/server/db/fixtures.ts`): one user and two QR codes with fixed `seed-` ids,
two layouts and 14 days of scans. It runs in one transaction and inserts with `ON CONFLICT DO NOTHING`, so a rerun adds
nothing, keeps edits you made to the demo rows, and never touches other data. It refuses the `production` target, and
it refuses a database where `ana@example.com` belongs to a different account.

## Tests

- `pnpm test` runs unit tests, including the target and guard rules. Database tests are skipped without
  `TEST_DATABASE_URL`.
- `pnpm test:db` runs the real-Postgres tests against `TEST_DATABASE_URL`. The suite resets that database, then checks:
  - migrating a fresh database, rerunning it, and two concurrent runs;
  - seeding twice without duplicates or overwrites;
  - the health check.
- CI runs the same against a fresh `postgres:17` service: migrate twice, seed twice, `db:verify`, `test:db`.

## Hosted dev

Vercel Preview deployments are the hosted **dev** environment and share one dev database (a Neon `dev` branch),
separate from production. Setup and the full variable matrix are in [ENVIRONMENTS.md](ENVIRONMENTS.md#one-time-hosted-setup-not-done-yet).

Every pull request that changes `drizzle/` or `src/server/db/` runs the **Dev database** workflow, which migrates the
dev database (GitHub environment `dev`, secrets `DEV_DATABASE_URL` and `DEV_DATABASE_URL_UNPOOLED`) before the
deployment uses it. Runs are queued one at a time; run it by hand with "seed" ticked to load the demo data.

Verify with `https://<dev-domain>/api/health`: `"environment": "dev"`, `"target": "dev"`, `"ok": true`.

Because the dev database is shared, two open pull requests with conflicting migrations can't both be deployed to dev.
Merge or rebase one first, or reset the Neon dev branch from `main`.

## Production

Production migrations are explicit: run **Actions → Production database**, type `production`, and approve the
`production` environment. Locally, with the production URLs:

```bash
APP_ENV=production CONFIRM_PRODUCTION_MIGRATION=1 DATABASE_URL=… DATABASE_URL_UNPOOLED=… pnpm db:migrate
```

Fixtures are never loaded into production.

## Troubleshooting

| Symptom                                                                 | Fix                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot connect … (ECONNREFUSED)`                                       | Postgres isn't running: `pnpm db:up` or `brew services start postgresql@17`; check the host and port in `DATABASE_URL`.        |
| `password authentication failed` / `role "heyqr" does not exist`        | Create the role and databases as shown in Local setup, or fix the credentials in `.env`.                                       |
| `database "heyqr_test" does not exist`                                  | `createdb -O heyqr heyqr_test`.                                                                                                |
| `/api/health` returns 503 with `schema_missing` or `migrations_pending` | Run `pnpm db:migrate` against that environment.                                                                                |
| `APP_ENV is "…" but Vercel's … scope serves …`                          | Set `APP_ENV` in that Vercel scope to the value named in the error (Preview → `dev`, Production → `production`), or remove it. |
| `DATABASE_TARGET only accepts "test"`                                   | HEY-7's `local` / `preview` / `production` targets are now `APP_ENV`; remove `DATABASE_TARGET` or set `APP_ENV`.               |
| `Refusing to seed …` / `Refusing to migrate the production database …`  | Expected safeguard; check you are pointed at the database you meant.                                                           |
| Migration fails half-way                                                | Each migration runs in a transaction and is rolled back. Fix the SQL or the data, then rerun `pnpm db:migrate`.                |
| `must be owner of …` during `pnpm test:db`                              | The test database must be owned by the role in `TEST_DATABASE_URL`: `alter database heyqr_test owner to heyqr;`.               |
| `pnpm db:migrate` waits forever                                         | Another run holds the migration lock: let it finish, or check `select * from pg_locks where locktype = 'advisory';`.           |

## Uploaded logos (HEY-83)

Uploaded logos live in the private storage bucket (`S3_*`, Cloudflare R2 in hosted environments), one bucket per
environment, never public. A saved layout refers to a logo as `asset:<id>` (table `asset`: owner, storage key, type,
size, sha256, last use). The server reads a code's layouts through `server/qr/repository.ts`, which resolves those
references for the code's owner only; nothing is served from a URL.

- **Temporary**: stored by a save (an uploaded image is checked with the HEY-50 rule and stored once per account and
  file) but not referenced by any saved layout yet, for example when the save was then refused.
- **Attached**: referenced by at least one layout, including layouts of soft-deleted codes, which can still be restored.
  Variants and copies that use the same file share one asset; replacing a logo on a copy stores a new one.
- **Eligible for cleanup**: unreferenced and unused for 24 hours. `pnpm assets:cleanup` removes those rows under row
  locks (a save in flight keeps its file and touches it), then their objects. Production needs
  `CONFIRM_PRODUCTION_CLEANUP=1`.

Older layouts that still hold an inline `data:` logo keep rendering unchanged; the next save of that layout moves the
file to private storage. No logo was ever stored behind a public URL (the old presign route had no caller), so there
are no public objects to migrate. To check a hosted environment before retiring any public access: open a saved layout
with a logo, confirm its `qr_layout.design` holds `asset:<id>` and no `data:image`, that the editor, thumbnail and an
export show the logo, and that an anonymous request to the object's key is refused.
