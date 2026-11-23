import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Fresh slugs tried before giving up. 7 characters of 55 make even one collision very unlikely. */
export const SHORT_CODE_ATTEMPTS = 5;

/** No free slug after SHORT_CODE_ATTEMPTS tries. The caller's transaction rolls back, and a webhook gets retried. */
export class ShortCodeExhaustedError extends Error {
  override name = "ShortCodeExhaustedError";
}

/** The unique constraint on qr_code.short_code (another code already holds the candidate). */
function isSlugTaken(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === "23505" && pg.constraint === "qr_code_short_code_unique") return true;
  }
  return false;
}

/**
 * HEY-117: the code's permanent short link. It is assigned once, from NULL, and from then on it is only read back:
 * - **Issued already:** that slug is returned, and the generator isn't called.
 * - **Concurrent first assignments for the same code** (trial, plan activation, subscription fulfilment) converge.
 *   The write is conditional on `short_code IS NULL`, so the second waits on the row, finds it set and returns the
 *   first one's slug.
 * - **A candidate another code holds:** each try runs in its own savepoint. A unique violation rolls back only
 *   that try, and another candidate is tried, up to `attempts`.
 *
 * Call it inside the operation's transaction, so the slug commits together with the activation.
 */
export async function assignShortCode(
  db: Db | Tx,
  qrCodeId: string,
  generate: () => string,
  attempts: number = SHORT_CODE_ATTEMPTS,
): Promise<string> {
  const current = async () => {
    const [row] = await db.select({ shortCode: schema.qrCode.shortCode }).from(schema.qrCode).where(eq(schema.qrCode.id, qrCodeId));
    if (!row) throw new Error("assignShortCode: no such code");
    return row.shortCode;
  };
  const issued = await current();
  if (issued) return issued;

  for (let i = 0; i < attempts; i++) {
    const candidate = generate();
    let claimed: { shortCode: string | null }[];
    try {
      claimed = await db.transaction((sp) =>
        sp
          .update(schema.qrCode)
          .set({ shortCode: candidate })
          .where(and(eq(schema.qrCode.id, qrCodeId), isNull(schema.qrCode.shortCode)))
          .returning({ shortCode: schema.qrCode.shortCode }),
      );
    } catch (error) {
      if (isSlugTaken(error)) continue;
      throw error;
    }
    if (claimed[0]?.shortCode) return claimed[0].shortCode;
    // Assigned meanwhile by a concurrent operation that has committed: that slug is the code's.
    const assigned = await current();
    if (assigned) return assigned;
  }
  throw new ShortCodeExhaustedError(`no free short code after ${attempts} attempts`);
}
