/**
 * Which database a process is pointed at, and what it may do there.
 * Plain module (no "server-only"): the migrate / seed / verify scripts run it under tsx.
 *
 *   local       a developer's own database (Homebrew Postgres or `pnpm db:up`)
 *   test        throw-away databases for automated tests and CI; name must end in `_test`
 *   preview     the shared preview database used by Vercel preview deployments
 *   production  the live database
 *
 * The target comes from DATABASE_TARGET, or from VERCEL_ENV on Vercel; the two must agree when both are set.
 */
export const DB_TARGETS = ["local", "test", "preview", "production"] as const;
export type DbTarget = (typeof DB_TARGETS)[number];

/** A configuration problem with a message that says what to change. Never includes credentials. */
export class DatabaseConfigError extends Error {
  override name = "DatabaseConfigError";
}

type Env = Record<string, string | undefined>;

export function resolveDbTarget(env: Env = process.env): DbTarget {
  const explicit = env.DATABASE_TARGET || undefined;
  if (explicit !== undefined && !DB_TARGETS.includes(explicit as DbTarget)) {
    throw new DatabaseConfigError(`DATABASE_TARGET must be one of ${DB_TARGETS.join(", ")} (got "${explicit}").`);
  }
  const vercel = env.VERCEL_ENV;
  if (vercel === "production" || vercel === "preview") {
    if (explicit && explicit !== vercel) {
      throw new DatabaseConfigError(
        `DATABASE_TARGET is "${explicit}" but this is a Vercel ${vercel} deployment. Set DATABASE_TARGET=${vercel} for the ${vercel} environment in Vercel.`,
      );
    }
    return vercel;
  }
  if (explicit) return explicit as DbTarget;
  return env.NODE_ENV === "test" ? "test" : "local";
}

/** `host:port/database` only: safe to print in logs and reports. */
export function describeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "<unparseable URL>";
  }
}

export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

/** Runtime queries: the pooled URL. */
export function runtimeUrl(env: Env = process.env): string {
  const url = env.DATABASE_URL;
  if (!url)
    throw new DatabaseConfigError(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at your database (see docs/DATABASE.md).",
    );
  return url;
}

/**
 * Migrations: a direct (unpooled) connection when the provider has one. Neon's pooler runs PgBouncer in
 * transaction mode, which can't hold the session-level advisory lock migrations take, so Vercel + Neon
 * sets DATABASE_URL_UNPOOLED. Local Postgres has no pooler, so DATABASE_URL works for both.
 */
export function migrationUrl(env: Env = process.env): string {
  return env.DATABASE_URL_UNPOOLED || runtimeUrl(env);
}

export type DbOperation = "migrate" | "seed" | "reset";

/** Stops setup operations from touching the wrong database. Throws DatabaseConfigError with the reason. */
export function assertAllowed(operation: DbOperation, target: DbTarget, url: string, env: Env = process.env): void {
  const where = `${target} database ${describeDatabaseUrl(url)}`;
  if (operation === "seed" && target === "production") {
    throw new DatabaseConfigError(`Refusing to seed the ${where}: fixtures are for local, test and preview databases only.`);
  }
  if (operation === "migrate" && target === "production" && env.CONFIRM_PRODUCTION_MIGRATION !== "1") {
    throw new DatabaseConfigError(`Refusing to migrate the ${where} without CONFIRM_PRODUCTION_MIGRATION=1.`);
  }
  if (operation === "reset" && (target !== "test" || !databaseName(url).endsWith("_test"))) {
    throw new DatabaseConfigError(`Refusing to reset the ${where}: resets run only on test databases whose name ends in "_test".`);
  }
}
