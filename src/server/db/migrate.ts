/** `pnpm db:migrate`: applies committed migrations to the database of the selected environment (APP_ENV / VERCEL_ENV, or test). */
import { runMigrations } from "./migrator";
import { assertAllowed, describeDatabaseUrl, migrationUrl, resolveDbTarget } from "./target";
import { EnvConfigError } from "../../shared/config/app-env";

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
  console.error(error instanceof EnvConfigError ? error.message : error);
  process.exitCode = 1;
});
