# Backup and restore

HEY-177 / QR-24.03. A logical PostgreSQL backup, its restore into an **empty** database, and the checks before HeyQR uses
it. Rehearsed locally (see the drill record). **The hosted procedure (Neon) has not been rehearsed**: see the end.

## Rules

- Restore into a new, empty database. Never over the one in use, and never with `--clean`.
- Back up the whole database: the `public` and `drizzle` schemas. Without `drizzle` the migration journal is lost and
  the next `pnpm db:migrate` tries to create everything again.
- Never restore data only into a migrated database: it fails on foreign keys (tried in the drill), and the slug triggers
  are already active there. A full restore creates constraints and triggers after the data.
- Don't run `pnpm db:migrate` or `pnpm db:seed` on the target before the checks below pass.
- `pg_dump` / `pg_restore` must be at least the server's major version. Use a direct connection, not Neon's pooler.
- A dump holds personal data, sessions and API key verifiers: encrypt it, limit access, delete it when done.

## Back up

`SRC` and `DST` are direct connection URLs. Check both before anything else: the right database, and `DST` with 0 objects.

```bash
umask 077; W=$(mktemp -d) # dumps stay out of the repository; delete it when done

for u in "$SRC" "$DST"; do psql "$u" -At -v ON_ERROR_STOP=1 -c "
  select current_database(), current_user, inet_server_addr(), inet_server_port(), version(),
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname !~ '^pg_' and n.nspname <> 'information_schema') as objects"; done

pg_dump "$SRC" -Fc --no-owner --no-privileges -f "$W/heyqr.dump"
shasum -a 256 "$W/heyqr.dump"
```

## Restore

```bash
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -d "$DST" "$W/heyqr.dump"
```

One transaction: any error, a non-empty target or a truncated file exits non-zero and leaves the target as it was.

## Verify before starting the app

`pnpm db:verify` checks that the tables exist and **counts** migrations; it compares no hashes, data or triggers. Do all
of this:

```bash
DATABASE_URL="$DST" pnpm db:verify

# Journal: the recorded hashes are the committed migration files'.
node -e 'for (const e of require("./drizzle/meta/_journal.json").entries) console.log(e.tag)' |
  while read -r t; do shasum -a 256 "drizzle/$t.sql" | cut -d' ' -f1; done > "$W/expected.txt"
psql "$DST" -Atc 'select hash from drizzle.__drizzle_migrations order by id' | diff "$W/expected.txt" - && echo "journal ok"

# Schema: needs SRC at the same migration.
for s in SRC DST; do eval "u=\$$s"; pg_dump "$u" -s --no-owner --no-privileges | grep -vE '^\\(un)?restrict' > "$W/$s.sql"; done
diff "$W/SRC.sql" "$W/DST.sql" && echo "schema ok"

# Data: row count and digest per table. On SRC only if nothing was written since the backup; else compare counts.
cat > "$W/fingerprint.sql" <<'SQL'
select format('select %L, count(*), coalesce(md5(string_agg(r::text, E''\n'' order by r::text collate "C")), ''-'') from %I.%I r;',
  schemaname || '.' || tablename, schemaname, tablename)
from pg_tables where schemaname in ('public', 'drizzle') order by 1 \gexec
SQL
for s in SRC DST; do eval "u=\$$s"; psql "$u" -At -v ON_ERROR_STOP=1 -f "$W/fingerprint.sql" > "$W/$s.txt"; done
diff "$W/SRC.txt" "$W/DST.txt" && echo "data ok"
```

A dump from an older release has fewer migrations: check its hashes against the first lines of `$W/expected.txt`, run
`pnpm db:migrate` only then, and verify again.

## Smoke test

Start the app with `DATABASE_URL` = the target and **test** configuration (test Stripe keys, no e-mail), with the source
refusing connections so it can't be read by mistake. `GET /api/health` must answer `ok`. Then:

1. A known Dynamic short link, anonymously: 302 to its exact destination; its count goes up by one. With
   `x-heyqr-test: 1` it doesn't.
2. The owner of an unlocked Static code exports it (200, decodes to its content); another account gets 404, nobody 401,
   the owner's unpaid draft 402. Sessions survive a restore only with the same `BETTER_AUTH_SECRET`.
3. Resend a processed Stripe event: `{"received":true,"duplicate":true}`, and no change in `purchase`, `credit_ledger`,
   `qr_code`. The same payment under another event id is recorded in `webhook_event` and grants nothing. (A plan's
   Checkout also touches its code's `updated_at`; nothing else.)

Smoke tests write to the target. Restore again into another empty database for real use.

## What a restore doesn't bring back

Everything written after the backup is gone. Before a restored database serves real traffic:

- **Short links issued since** aren't reserved, so the app could issue the same slug again for another code. Printed
  copies of the lost code answer "unavailable". Recover those slugs from the old database and insert them into
  `short_code_reservation` first.
- **Payments, refunds and subscriptions since:** resend Stripe's events from the backup time on, oldest first. Orders
  created after the backup don't exist, so their payment reports `billing.paid_not_granted` / `no_order`
  (MONITORING.md): fix those by hand.
- **Revoked API keys and signed-out sessions are valid again**; deleted accounts and codes are back, and destinations are
  the old ones. Revoke and delete again; consider clearing `session`.
- **Scans** since are lost.
- **Object storage isn't in the database backup.** Paid export files are rendered again when missing. Uploaded logos and
  hosted-page files (`asset`) are not: their objects must still be in the bucket. Pause `pnpm assets:cleanup`
  until the restored database is checked, and check every `asset.storage_key` against the bucket.

## Drill record

| 2026-11-25, local | HEY-177, code at `56b54a3`                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| PostgreSQL        | 14.17 (server, `pg_dump`, `pg_restore`), disposable cluster, non-superuser owner                        |
| Source            | 19 migrations, 22 tables + journal, synthetic rows, 10.3 MB on disk                                     |
| Backup            | 55,949 bytes, 0.08 s                                                                                    |
| Restore           | 0.06 s (tiny data set: not an estimate of a production recovery time)                                   |
| Verified          | journal, schema, triggers, every row; short link, scan, export, denied account, webhook replay          |
| Object storage    | not configured: exports regenerated from the restored design; nothing restored or reused; no logo files |

Not rehearsed: PostgreSQL 17 (what Compose and CI use), Neon backups or point-in-time restore (retention, access,
duration), a database of realistic size, object storage, and the switch of a deployment to a restored database.
