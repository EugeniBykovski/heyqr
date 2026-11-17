import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { appliedMigrations } from "./check";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));
/** Arbitrary constant key: only one migration run per database at a time (e.g. two preview deploys at once). */
const MIGRATION_LOCK = 7_310_420_001;

/**
 * Applies the committed migrations in ./drizzle that the database hasn't recorded yet.
 * Uses one direct connection, holds a session advisory lock while migrating, and always closes the connection.
 */
export async function runMigrations(url: string): Promise<{ before: number; after: number }> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      const before = await appliedMigrations(client);
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      return { before, after: await appliedMigrations(client) };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  } finally {
    await client.end();
  }
}
