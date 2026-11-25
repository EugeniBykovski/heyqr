import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";

/*
 * HEY-178 / QR-24.04: the public API's request budgets per account (docs/API_V1.md). One row per account and bucket,
 * moved by one statement: the insert-or-update locks the row, so concurrent requests on any number of app instances
 * never share a slot, and the database's clock decides the window, so instances' clocks don't matter.
 * Plain module (no "server-only", no env import) so the PostgreSQL tests run it; src/env.ts validates the settings.
 */
type Db = NodePgDatabase<typeof schema>;

/** "api": every request. "export": rendering, counted in "api" as well. */
export type Bucket = "api" | "export";
export type Limits = Record<Bucket, number>;
export const DEFAULT_LIMITS: Limits = { api: 120, export: 30 };
export const WINDOW_SECONDS = 60;
/** How long a request waits for its budget before it counts as unavailable. */
export const STORE_TIMEOUT_MS = 2_000;

export function readLimits(env: Record<string, string | undefined> = process.env): Limits {
  const read = (name: string, fallback: number) => {
    const n = Number(env[name] || fallback);
    return Number.isInteger(n) && n >= 1 ? n : fallback;
  };
  return {
    api: read("API_RATE_LIMIT_PER_MINUTE", DEFAULT_LIMITS.api),
    export: read("API_RATE_LIMIT_EXPORTS_PER_MINUTE", DEFAULT_LIMITS.export),
  };
}

export type Taken = { ok: true } | { ok: false; retryAfterSeconds: number };

/** The store didn't answer in time. */
export class RateLimitTimeoutError extends Error {
  override name = "RateLimitTimeoutError";
}

/**
 * Takes one request from the account's budget, or says when the window ends. Throws when the store can't answer: the
 * caller refuses the request. The count stops one above the limit, so refused requests change nothing further and never
 * move the window. `now` is for tests; without it, the database's clock.
 */
export async function takeRequest(
  db: Db,
  userId: string,
  bucket: Bucket,
  options: { limits?: Limits; now?: Date; timeoutMs?: number } = {},
): Promise<Taken> {
  const limit = (options.limits ?? readLimits())[bucket];
  const now = options.now ? sql`${options.now.toISOString()}::timestamptz` : sql`clock_timestamp()`;
  const window = sql`make_interval(secs => ${WINDOW_SECONDS})`;
  const t = schema.apiRateLimit;
  const started = sql`(excluded.window_start >= ${t.windowStart} + ${window})`;
  const query = db
    .insert(t)
    .values({ userId, bucket, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: [t.userId, t.bucket],
      set: {
        windowStart: sql`case when ${started} then excluded.window_start else ${t.windowStart} end`,
        count: sql`case when ${started} then 1 else least(${t.count} + 1, ${limit}::int + 1) end`,
      },
    })
    .returning({
      count: t.count,
      wait: sql<number>`greatest(1, least(${WINDOW_SECONDS}::int, ceil(extract(epoch from ${t.windowStart} + ${window} - ${now}))))::int`,
    })
    .then((rows) => rows);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RateLimitTimeoutError("rate limit store timed out")), options.timeoutMs ?? STORE_TIMEOUT_MS);
  });
  try {
    // A query that loses the race settles on its own; Promise.race has already attached a handler to it.
    const [row] = await Promise.race([query, late]);
    if (!row) throw new Error("rate limit store returned nothing");
    return row.count <= limit ? { ok: true } : { ok: false, retryAfterSeconds: Number(row.wait) };
  } finally {
    clearTimeout(timer);
  }
}
