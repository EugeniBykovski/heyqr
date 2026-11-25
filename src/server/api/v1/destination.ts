import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../../db/schema";
import { changeDestination } from "../../qr/destination";
import type { Problem } from "./create-qr";

/*
 * HEY-157 / QR-21.05: a Dynamic code's destination through the public API:
 *   GET   /api/v1/qr-codes/{qrCodeId}/destination   the current destination and its revision
 *   PATCH /api/v1/qr-codes/{qrCodeId}/destination   { destination, revision }
 * Scoped to the verified key's owner (another account's, deleted or missing code: one "not found"). The update is the
 * dashboard's own Change destination (changeDestination): the same HTTP(S) rule, the row lock, the HEY-128 revision
 * check, one HEY-125 history entry per real change, and no write for the URL already stored. The code's id, short link,
 * layouts, scans and activation never change. Plain module (no "server-only") so the PostgreSQL tests run it.
 */
type Db = NodePgDatabase<typeof schema>;

/** What the API shows: explicit fields only. `shortLink` is null until the code is activated. */
export type ApiDestination = {
  qrCodeId: string;
  destination: string;
  revision: number;
  previousDestination: string | null;
  changedAt: string | null;
  shortLink: string | null;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

async function ownedCode(db: Db, userId: string, qrCodeId: string) {
  if (!ID.test(qrCodeId)) return null;
  const [row] = await db
    .select({
      id: schema.qrCode.id,
      model: schema.qrCode.model,
      content: schema.qrCode.content,
      shortCode: schema.qrCode.shortCode,
      destination: schema.qrCode.destination,
      previousDestination: schema.qrCode.previousDestination,
      changedAt: schema.qrCode.destinationChangedAt,
      revision: schema.qrCode.destinationRevision,
    })
    .from(schema.qrCode)
    .where(and(eq(schema.qrCode.id, qrCodeId), eq(schema.qrCode.userId, userId), isNull(schema.qrCode.deletedAt)));
  return row ?? null;
}

type Owned = NonNullable<Awaited<ReturnType<typeof ownedCode>>>;
export type ShortLinkFor = (code: Owned) => string;

const view = (row: Owned, shortLinkFor: ShortLinkFor): ApiDestination => ({
  qrCodeId: row.id,
  destination: row.destination ?? "",
  revision: row.revision,
  previousDestination: row.previousDestination,
  changedAt: row.changedAt?.toISOString() ?? null,
  shortLink: row.shortCode ? shortLinkFor(row) : null,
});

export type ReadDestinationOutcome = { ok: true; destination: ApiDestination } | { ok: false; error: "not_found" | "not_dynamic" };

/** GET: the owner's code's destination. A static code has none (`not_dynamic`, told only to its owner). */
export async function readDestinationForOwner(
  db: Db,
  userId: string,
  qrCodeId: string,
  shortLinkFor: ShortLinkFor,
): Promise<ReadDestinationOutcome> {
  const row = await ownedCode(db, userId, qrCodeId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.model !== "dynamic") return { ok: false, error: "not_dynamic" };
  return { ok: true, destination: view(row, shortLinkFor) };
}

export const updateDestinationRequestSchema = z.strictObject({
  destination: z.string().max(2048),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type UpdateDestinationOutcome =
  | { ok: true; destination: ApiDestination; changed: boolean }
  | { ok: false; error: "not_found" | "not_dynamic" }
  | { ok: false; error: "conflict"; current: { destination: string; revision: number } }
  | { ok: false; error: "invalid_request"; details: Problem[] };

const pathOf = (path: readonly PropertyKey[]) =>
  path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
    .join("")
    .replace(/^\./, "");

/** PATCH: changes the destination from `revision`, exactly as the dashboard's Change destination does. */
export async function updateDestinationForOwner(
  db: Db,
  userId: string,
  qrCodeId: string,
  body: unknown,
  shortLinkFor: ShortLinkFor,
): Promise<UpdateDestinationOutcome> {
  const owned = await ownedCode(db, userId, qrCodeId);
  if (!owned) return { ok: false, error: "not_found" };
  if (owned.model !== "dynamic") return { ok: false, error: "not_dynamic" };
  const parsed = updateDestinationRequestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.flatMap((issue): Problem[] =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => ({ path: pathOf([...issue.path, key]), message: "Unknown field" }))
        : [{ path: pathOf(issue.path) || "(body)", message: issue.message }],
    );
    return { ok: false, error: "invalid_request", details: details.slice(0, 20) };
  }
  const { destination, revision } = parsed.data;
  const result = await changeDestination(db, userId, qrCodeId, destination, revision);
  if (!result.ok) {
    if (result.error === "not_found") return { ok: false, error: "not_found" };
    if (result.error === "conflict")
      return { ok: false, error: "conflict", current: { destination: result.latest.destination, revision: result.latest.revision } };
    return { ok: false, error: "invalid_request", details: [{ path: "destination", message: `Invalid destination (${result.problem})` }] };
  }
  const row = await ownedCode(db, userId, qrCodeId);
  if (!row) return { ok: false, error: "not_found" };
  // The state changeDestination committed (a later change may already be stored; the revision says which this is).
  const data = result.data;
  return {
    ok: true,
    changed: data.revision !== revision,
    destination: {
      ...view(row, shortLinkFor),
      destination: data.destination,
      revision: data.revision,
      previousDestination: data.previousDestination,
      changedAt: data.changedAt,
    },
  };
}
