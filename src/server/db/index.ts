import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import * as schema from "./schema";
import { describeDatabaseUrl, resolveDbTarget } from "./target";

const globalForDb = globalThis as unknown as { pool?: Pool };

/**
 * One pool per server instance, reused across hot reloads in development.
 * On Vercel each function instance gets a small pool that releases idle connections quickly; DATABASE_URL there is
 * Neon's pooled (PgBouncer) endpoint, so many instances share few Postgres connections. Locally a larger pool is fine.
 * On Vercel (Fluid compute) the pool is attached to the function's lifecycle, so idle clients are released before an
 * instance is suspended instead of leaking connections (Neon's guidance for node-postgres on Vercel).
 */
function createPool() {
  const serverless = Boolean(process.env.VERCEL);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: serverless ? 5 : 10,
    idleTimeoutMillis: serverless ? 5_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client can be dropped by the server (restart, pooler timeout); log it without the connection string.
  pool.on("error", (error) => {
    console.error(`[db] idle client error on the ${resolveDbTarget()} database ${describeDatabaseUrl(env.DATABASE_URL)}: ${error.message}`);
  });
  if (serverless) attachDatabasePool(pool);
  return pool;
}

const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };
