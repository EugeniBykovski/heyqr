import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newId } from "../db/ids";
import * as schema from "../db/schema";

/*
 * HEY-153 / QR-21.01: account-scoped API keys. Format (shared with HEY-154's verification; docs/API_KEYS.md):
 *
 *   hqk_<lookupId>_<secret>
 *
 * - lookupId: 12 characters [A-Za-z0-9] from 9 random bytes; public. Stored in api_key.lookup_id (unique) and shown as
 *   the key's prefix `hqk_<lookupId>`; a presented key is found by it.
 * - secret: 32 random bytes (crypto.randomBytes) as base64url, 43 characters; never stored.
 * - Verifier: api_key.secret_hash = "sha256:" + hex(SHA-256(secret)). The secret has 256 bits of entropy, so a fast
 *   hash is enough; comparison is constant-time.
 * The full key exists only in the creation response. HEY-154: revocation (revoked_at) and last use (last_used_at).
 * Plain module (no "server-only") so the PostgreSQL tests run it.
 */
type Db = NodePgDatabase<typeof schema>;

export const API_KEY_PREFIX = "hqk_";
const LOOKUP = /^[A-Za-z0-9]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

const lookupIdFrom = (bytes: Buffer) =>
  bytes
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 12);
const verifierOf = (secret: string) => `sha256:${createHash("sha256").update(secret, "utf8").digest("hex")}`;

/** A new key, generated on the server with a cryptographically secure generator. */
export function generateApiKey() {
  let lookupId = "";
  while (lookupId.length < 12) lookupId = lookupIdFrom(randomBytes(12));
  const secret = randomBytes(32).toString("base64url");
  return { key: `${API_KEY_PREFIX}${lookupId}_${secret}`, lookupId, secretHash: verifierOf(secret) };
}

/** A presented key split into its parts, or null when it isn't a well-formed HeyQR key. */
export function parseApiKey(key: unknown): { lookupId: string; secret: string } | null {
  if (typeof key !== "string" || !key.startsWith(API_KEY_PREFIX)) return null;
  const rest = key.slice(API_KEY_PREFIX.length);
  const lookupId = rest.slice(0, 12);
  const secret = rest.slice(13);
  if (rest[12] !== "_" || !LOOKUP.test(lookupId) || !SECRET.test(secret)) return null;
  return { lookupId, secret };
}

/** What a management view may show about a key: never the key or its verifier. */
export type ApiKeySummary = { id: string; prefix: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };

const summary = (row: {
  id: string;
  lookupId: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}): ApiKeySummary => ({
  id: row.id,
  prefix: `${API_KEY_PREFIX}${row.lookupId}`,
  createdAt: row.createdAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

const summaryColumns = {
  id: schema.apiKey.id,
  lookupId: schema.apiKey.lookupId,
  createdAt: schema.apiKey.createdAt,
  revokedAt: schema.apiKey.revokedAt,
  lastUsedAt: schema.apiKey.lastUsedAt,
};

/** Issues a key for this account. The returned `key` is the only time the full key exists; it isn't stored. */
export async function createApiKey(db: Db, userId: string): Promise<ApiKeySummary & { key: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { key, lookupId, secretHash } = generateApiKey();
    const [row] = await db
      .insert(schema.apiKey)
      .values({ id: newId(), userId, lookupId, secretHash })
      .onConflictDoNothing({ target: schema.apiKey.lookupId })
      .returning(summaryColumns);
    if (row) return { ...summary(row), key };
  }
  throw new Error("createApiKey: no free lookup id");
}

/** The account's keys, newest first, as safe metadata only. */
export async function listApiKeys(db: Db, userId: string): Promise<ApiKeySummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(schema.apiKey)
    .where(eq(schema.apiKey.userId, userId))
    .orderBy(desc(schema.apiKey.createdAt), desc(schema.apiKey.id));
  return rows.map(summary);
}

/**
 * HEY-154: revokes one of the account's keys. Scoped to the owner: another account's key id changes nothing and reads
 * as not found. Revoking again is harmless and keeps the original time. Returns the stored revocation time.
 */
export async function revokeApiKey(db: Db, userId: string, keyId: string): Promise<{ revokedAt: string } | null> {
  const [row] = await db
    .update(schema.apiKey)
    .set({ revokedAt: sql`coalesce(${schema.apiKey.revokedAt}, now())` })
    .where(and(eq(schema.apiKey.id, keyId), eq(schema.apiKey.userId, userId)))
    .returning({ revokedAt: schema.apiKey.revokedAt });
  return row?.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : null;
}

/**
 * The shared verifier: the owner (account id) of a presented key, or null. Null for anything that doesn't verify:
 * malformed, unknown, wrong secret or revoked, with no way to tell these apart. The secret is compared in constant
 * time; then one conditional update claims the key only while it isn't revoked and records the successful use
 * (last_used_at), so an attempt that starts after a revocation has committed is refused, and failed or revoked
 * attempts leave last_used_at alone. Every API path that accepts a key scopes its data to this owner (HEY-155 / HEY-159).
 */
export async function apiKeyOwner(db: Db, key: unknown): Promise<string | null> {
  const parsed = parseApiKey(key);
  if (!parsed) return null;
  const [row] = await db
    .select({ id: schema.apiKey.id, secretHash: schema.apiKey.secretHash })
    .from(schema.apiKey)
    .where(eq(schema.apiKey.lookupId, parsed.lookupId));
  if (!row) return null;
  const expected = Buffer.from(row.secretHash);
  const presented = Buffer.from(verifierOf(parsed.secret));
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  const [active] = await db
    .update(schema.apiKey)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(schema.apiKey.id, row.id), isNull(schema.apiKey.revokedAt)))
    .returning({ userId: schema.apiKey.userId });
  return active?.userId ?? null;
}
