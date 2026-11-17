# Database: PostgreSQL + Drizzle

The app uses PostgreSQL through Drizzle ORM and the `pg` driver (`src/server/db`). The schema lives in
`src/server/db/schema.ts`; committed SQL migrations live in `drizzle/`.

## Database targets

Every process knows which database it is pointed at. The target comes from `DATABASE_TARGET`, or from `VERCEL_ENV` on
Vercel; when both are set they must agree, otherwise commands stop with an error (`src/server/db/target.ts`).

| Target       | Used by                              | Database                                    | Seeding | Migrating                                  |
| ------------ | ------------------------------------ | ------------------------------------------- | ------- | ------------------------------------------ |
| `local`      | `pnpm dev` on your machine (default) | `heyqr` on local Postgres                   | yes     | yes                                        |
| `test`       | `pnpm test:db`, CI `database` job    | a database whose name ends in `_test`       | yes     | yes; tests also reset it                   |
| `preview`    | Vercel preview deployments           | one shared preview database (a Neon branch) | yes     | yes, via the Preview database workflow     |
| `production` | Vercel production                    | the production database                     | never   | only with `CONFIRM_PRODUCTION_MIGRATION=1` |

Logs, `pnpm db:verify` and `GET /api/health` identify a database only by its target and `host:port/name`, never by
credentials.

## Environment variables

| Variable                | Required | Purpose                                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | yes      | Connection used by the app (on Neon: the **pooled** endpoint).                             |
| `DATABASE_URL_UNPOOLED` | on Neon  | Direct connection used by `pnpm db:migrate` and drizzle-kit. Falls back to `DATABASE_URL`. |
| `DATABASE_TARGET`       | no       | `local`, `test`, `preview` or `production`. Leave empty locally; on Vercel it is implied.  |
| `TEST_DATABASE_URL`     | tests    | Database that `pnpm test:db` **drops and recreates**. Its name must end in `_test`.        |

Values go in `.env` locally (copied from `.env.example`) and in Vercel's project settings per environment. Never commit
them.

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
database; preview and production only ever receive committed migrations.

`pnpm db:migrate` applies only the migrations the database hasn't recorded (`drizzle.__drizzle_migrations`), so it is
safe to rerun. It holds a Postgres advisory lock, so concurrent runs against the same database wait for each other.

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

## Preview

Preview deployments run on Vercel and use one shared preview database, separate from production.

One-time setup (needs the Vercel project and a Neon account):

1. In Neon, create a branch `preview` from `main` (or a separate project) for preview data.
2. In Vercel → Project → Settings → Environment Variables, **Preview** environment:
   - `DATABASE_URL` = the preview branch's pooled connection string;
   - `DATABASE_URL_UNPOOLED` = its direct connection string;
   - `DATABASE_TARGET` = `preview`.

   The **Production** environment gets the production branch's URLs and `DATABASE_TARGET=production`. If you use Neon's
   Vercel integration instead, it sets the two URLs for you; keep it on one shared preview branch (don't enable a branch
   per deployment).

3. In GitHub → Settings → Environments → `preview`, add secrets `PREVIEW_DATABASE_URL` and
   `PREVIEW_DATABASE_URL_UNPOOLED` with the same two values.
4. Run **Actions → Preview database → Run workflow** with "seed" ticked once to migrate and load the demo data.

After that, every pull request that changes `drizzle/` or `src/server/db/` runs the **Preview database** workflow,
which migrates the preview database before the deployment uses it. Runs are queued one at a time.

Verify a preview deployment with `https://<preview-url>/api/health`. It should return `"ok": true` and
`"target": "preview"`.

Because the preview database is shared, two open pull requests with conflicting migrations can't both be previewed.
Merge or rebase one first, or reset the Neon preview branch from `main`.

## Production

Production migrations are explicit:

```bash
DATABASE_TARGET=production CONFIRM_PRODUCTION_MIGRATION=1 \
DATABASE_URL=… DATABASE_URL_UNPOOLED=… pnpm db:migrate
```

Fixtures are never loaded into production.

## Troubleshooting

| Symptom                                                                 | Fix                                                                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Cannot connect … (ECONNREFUSED)`                                       | Postgres isn't running: `pnpm db:up` or `brew services start postgresql@17`; check the host and port in `DATABASE_URL`. |
| `password authentication failed` / `role "heyqr" does not exist`        | Create the role and databases as shown in Local setup, or fix the credentials in `.env`.                                |
| `database "heyqr_test" does not exist`                                  | `createdb -O heyqr heyqr_test`.                                                                                         |
| `/api/health` returns 503 with `schema_missing` or `migrations_pending` | Run `pnpm db:migrate` against that target.                                                                              |
| `DATABASE_TARGET is "…" but this is a Vercel … deployment`              | Set `DATABASE_TARGET` for that Vercel environment to match it (`preview` or `production`), or remove it.                |
| `Refusing to seed …` / `Refusing to migrate the production database …`  | Expected safeguard; check you are pointed at the database you meant.                                                    |
| Migration fails half-way                                                | Each migration runs in a transaction and is rolled back. Fix the SQL or the data, then rerun `pnpm db:migrate`.         |
| `must be owner of …` during `pnpm test:db`                              | The test database must be owned by the role in `TEST_DATABASE_URL`: `alter database heyqr_test owner to heyqr;`.        |
| `pnpm db:migrate` waits forever                                         | Another run holds the migration lock: let it finish, or check `select * from pg_locks where locktype = 'advisory';`.    |
