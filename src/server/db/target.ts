import { EnvConfigError, resolveAppEnv, type AppEnv } from "../../shared/config/app-env";

/**
 * Which database a process is pointed at, and what it may do there.
 * Plain module (no "server-only"): the migrate / seed / verify scripts run it under tsx.
 *
 *   dev         the HeyQR dev environment: local development and the hosted dev deployment (Vercel Preview)
 *   production  the live database (Vercel Production)
 *   test        throw-away databases for automated tests and CI only; name must end in `_test`
 *
 * dev and production come from APP_ENV (or VERCEL_ENV), the same selector the app uses (shared/config/app-env.ts).
 * test is chosen by the test runner (NODE_ENV=test) or by DATABASE_TARGET=test, and never on a deployment.
 */
export const DB_TARGETS = ["dev", "production", "test"] as const;
export type DbTarget = AppEnv | "test";

/** A database configuration problem with a message that says what to change. Never includes credentials. */
export class DatabaseConfigError extends EnvConfigError {
  override name = "DatabaseConfigError";
}

type Env = Record<string, string | undefined>;

export function resolveDbTarget(env: Env = process.env): DbTarget {
  const explicit = env.DATABASE_TARGET || undefined;
  if (explicit !== undefined && explicit !== "test") {
    const hint = ["local", "preview", "dev"].includes(explicit)
      ? "APP_ENV=dev"
      : explicit === "production"
        ? "APP_ENV=production"
        : "APP_ENV=dev or APP_ENV=production";
    throw new DatabaseConfigError(
      `DATABASE_TARGET only accepts "test" (got "${explicit}"). Select the app environment with ${hint} instead.`,
    );
  }
  if (explicit === "test") {
    if (env.VERCEL_ENV)
      throw new DatabaseConfigError(
        `DATABASE_TARGET=test is for automated tests and can't be used on a Vercel ${env.VERCEL_ENV} deployment.`,
      );
    return "test";
  }
  if (env.NODE_ENV === "test") return "test";
  return resolveAppEnv(env);
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

export type DbOperation = "migrate" | "seed" | "reset" | "cleanup";

/** Stops setup operations from touching the wrong database. Throws DatabaseConfigError with the reason. */
export function assertAllowed(operation: DbOperation, target: DbTarget, url: string, env: Env = process.env): void {
  const where = `${target} database ${describeDatabaseUrl(url)}`;
  if (operation === "seed" && target === "production") {
    throw new DatabaseConfigError(`Refusing to seed the ${where}: fixtures are for the dev and test databases only.`);
  }
  if (operation === "migrate" && target === "production" && env.CONFIRM_PRODUCTION_MIGRATION !== "1") {
    throw new DatabaseConfigError(`Refusing to migrate the ${where} without CONFIRM_PRODUCTION_MIGRATION=1.`);
  }
  if (operation === "cleanup" && target === "production" && env.CONFIRM_PRODUCTION_CLEANUP !== "1") {
    throw new DatabaseConfigError(`Refusing to clean up logo files of the ${where} without CONFIRM_PRODUCTION_CLEANUP=1.`);
  }
  if (operation === "reset" && (target !== "test" || !databaseName(url).endsWith("_test"))) {
    throw new DatabaseConfigError(`Refusing to reset the ${where}: resets run only on test databases whose name ends in "_test".`);
  }
}
