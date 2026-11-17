/** `pnpm db:migrate`: applies committed migrations to the database DATABASE_TARGET / VERCEL_ENV points at. */
import { runMigrations } from "./migrator";
import { assertAllowed, DatabaseConfigError, describeDatabaseUrl, migrationUrl, resolveDbTarget } from "./target";

async function main() {
  const target = resolveDbTarget();
  const url = migrationUrl();
  assertAllowed("migrate", target, url);
  console.log(`Migrating the ${target} database ${describeDatabaseUrl(url)}…`);
  const { before, after } = await runMigrations(url);
  console.log(
    after > before ? `Applied ${after - before} migration(s); ${after} in total.` : `Up to date: ${after} migration(s) already applied.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof DatabaseConfigError ? error.message : error);
  process.exitCode = 1;
});
