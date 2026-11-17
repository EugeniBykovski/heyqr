/**
 * Demo data for local, test and preview databases: one user with a purchased static code and a dynamic code with scans.
 * Run with `pnpm db:seed` after `pnpm db:migrate`. Safe to rerun; refuses the production database.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { SEED_USER, seedFixtures } from "./fixtures";
import * as schema from "./schema";
import { assertAllowed, DatabaseConfigError, describeDatabaseUrl, resolveDbTarget, runtimeUrl } from "./target";

async function main() {
  const target = resolveDbTarget();
  const url = runtimeUrl();
  assertAllowed("seed", target, url);

  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await seedFixtures(drizzle(pool, { schema, casing: "snake_case" }));
    console.log(`Seeded the ${target} database ${describeDatabaseUrl(url)}: ${SEED_USER.email} with 2 codes.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DatabaseConfigError ? error.message : error);
  process.exitCode = 1;
});
