import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import journal from "../../../drizzle/meta/_journal.json";
import * as schema from "./schema";

/** Every table the application schema defines; the check fails if any is missing. */
export const REQUIRED_TABLES = (Object.values(schema) as unknown[]).flatMap((v) => (is(v, PgTable) ? [getTableName(v)] : [])).sort();

/** Committed migrations (drizzle/meta/_journal.json); the database should have applied all of them. */
export const EXPECTED_MIGRATIONS = journal.entries.length;

export type DatabaseCheck =
  | { ok: true; migrations: { applied: number; expected: number }; tables: number }
  | {
      ok: false;
      reason: "unreachable" | "schema_missing" | "migrations_pending";
      detail: string;
      migrations?: { applied: number; expected: number };
      missingTables?: string[];
    };

type Queryable = { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Connectivity + schema check used by GET /api/health and `pnpm db:verify`.
 * Reports only counts and table names, never connection details.
 */
export async function checkDatabase(client: Queryable): Promise<DatabaseCheck> {
  try {
    await client.query("select 1");
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { ok: false, reason: "unreachable", detail: code ? `connection failed (${code})` : "connection failed" };
  }

  const { rows: present } = await client.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${REQUIRED_TABLES.map((t) => `'${t}'`).join(", ")})`,
  );
  const found = new Set(present.map((r) => String(r.table_name)));
  const missingTables = REQUIRED_TABLES.filter((t) => !found.has(t));

  const migrations = { applied: await appliedMigrations(client), expected: EXPECTED_MIGRATIONS };

  if (missingTables.length) {
    return {
      ok: false,
      reason: "schema_missing",
      detail: `${missingTables.length} table(s) missing; run the migrations`,
      migrations,
      missingTables,
    };
  }
  if (migrations.applied < migrations.expected) {
    return {
      ok: false,
      reason: "migrations_pending",
      detail: `${migrations.expected - migrations.applied} migration(s) not applied`,
      migrations,
    };
  }
  return { ok: true, migrations, tables: REQUIRED_TABLES.length };
}

/** Migrations recorded by Drizzle; 0 on a fresh database (the table is only looked up once it exists). */
export async function appliedMigrations(client: Queryable): Promise<number> {
  const { rows } = await client.query("select to_regclass('drizzle.__drizzle_migrations') is not null as present");
  if (!rows[0]?.present) return 0;
  const counted = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  return Number(counted.rows[0]?.n ?? 0);
}
