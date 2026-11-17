/** `pnpm db:verify`: connects with the runtime URL and checks the schema and migrations, like GET /api/health. */
import { Client } from "pg";
import { checkDatabase } from "./check";
import { DatabaseConfigError, describeDatabaseUrl, resolveDbTarget, runtimeUrl } from "./target";

async function main() {
  const target = resolveDbTarget();
  const url = runtimeUrl();
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (error) {
    console.error(
      `Cannot connect to the ${target} database ${describeDatabaseUrl(url)} (${(error as { code?: string }).code ?? "error"}). Is Postgres running?`,
    );
    process.exitCode = 1;
    return;
  }
  try {
    const result = await checkDatabase(client);
    console.log(JSON.stringify({ target, database: describeDatabaseUrl(url), ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DatabaseConfigError ? error.message : error);
  process.exitCode = 1;
});
