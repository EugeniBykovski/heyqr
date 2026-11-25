import { createHash } from "node:crypto";
import { normalizeUrl, type QrContent } from "@heyqr/qr-core";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { contentErrors } from "../../../entities/qr/model/content-validation";
import { TEXT_MAX_CHARS } from "../../../entities/qr/model/content";
import { supportsMode } from "../../../entities/qr/model/modes";
import * as schema from "../../db/schema";
import type { PrepareRecord } from "../../qr/update-layout";
import { saveQrWithLayouts } from "../../qr/save-qr";

/*
 * HEY-155 / QR-21.03: POST /api/v1/qr-codes — create one QR code with its layouts, as a draft, for the account of the
 * verified API key (docs/API_V1.md). The request is create-only and strict: anything that could choose an owner,
 * address an existing code or layout, claim an editor draft, or set billing or activation state is an unknown field and
 * rejected (userId, qrCodeId, layout ids, claimKey, status, shortCode, paid, …). The write is the editor's own
 * transactional save (saveQrWithLayouts: draft limit, mode and destination rules, layout contract, capacity, logos).
 * Plain module (no "server-only") so the PostgreSQL tests run it.
 */

const str = (max = 2048) => z.string().max(max);
const opt = (max = 2048) => str(max).optional();

/** The content shape per type (qr-core QrContent), strict; the editor's content rules are applied after it. */
const contentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("website"), url: str() }),
  z.strictObject({ type: z.literal("text"), text: str(TEXT_MAX_CHARS) }),
  z.strictObject({
    type: z.literal("wifi"),
    ssid: str(64),
    security: z.enum(["WPA", "WEP", "nopass"]),
    password: opt(63),
    hidden: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("contact"),
    firstName: opt(200),
    lastName: opt(200),
    title: opt(200),
    company: opt(200),
    phone: opt(40),
    email: opt(254),
    website: opt(),
  }),
  z.strictObject({ type: z.literal("email"), to: str(254), subject: opt(200), body: opt(2000) }),
  z.strictObject({ type: z.literal("phone"), number: str(40) }),
  z.strictObject({ type: z.literal("sms"), number: str(40), message: opt(1000) }),
  z.strictObject({ type: z.literal("location"), name: opt(200), address: str(500) }),
  z.strictObject({
    type: z.literal("event"),
    title: str(200),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
    end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
      .optional(),
    place: opt(200),
  }),
]);

export const createQrRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  mode: z.enum(["static", "dynamic"]),
  content: contentSchema,
  // Dynamic only: where the short link sends people (defaults to the website address). Same check as the editor.
  destination: z.string().max(2048).optional(),
  layouts: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(60),
        // The versioned design contract (design-schema createLayoutRecord), checked in saveQrWithLayouts.
        layout: z.unknown(),
        editor: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export type CreateQrRequest = z.infer<typeof createQrRequestSchema>;

/** One reason a request is refused, for the response's `details`: where it is and what's wrong (never the value). */
export type Problem = { path: string; message: string };

export type CreateQrOutcome =
  | { ok: true; qrCodeId: string; layoutIds: string[]; replayed?: boolean }
  | { ok: false; error: "idempotency_key_reused" }
  | { ok: false; error: "invalid_request"; details: Problem[] }
  | { ok: false; error: "content_too_long" }
  | { ok: false; error: "draft_limit" };

const pathOf = (path: readonly PropertyKey[]) =>
  path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
    .join("")
    .replace(/^\./, "");

/** Validates a parsed JSON body: the strict shape, then the editor's content rules. */
export function readCreateRequest(body: unknown): { ok: true; value: CreateQrRequest } | { ok: false; details: Problem[] } {
  const parsed = createQrRequestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.flatMap((issue): Problem[] =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => ({ path: pathOf([...issue.path, key]), message: "Unknown field" }))
        : [{ path: pathOf(issue.path) || "(body)", message: issue.message }],
    );
    return { ok: false, details: details.slice(0, 20) };
  }
  const { mode, content, destination } = parsed.data;
  // Only website codes can be dynamic (entities/qr/model/modes.ts); a static code has no destination.
  if (!supportsMode(content.type, mode))
    return { ok: false, details: [{ path: "mode", message: `"${mode}" isn't available for ${content.type} codes` }] };
  if (mode === "static" && destination !== undefined)
    return { ok: false, details: [{ path: "destination", message: "Only dynamic codes have a destination" }] };
  const errors = contentErrors(content as QrContent);
  const fields = Object.keys(errors);
  if (fields.length > 0)
    return { ok: false, details: fields.map((field) => ({ path: `content.${field}`, message: `Invalid ${field} (${errors[field]})` })) };
  return { ok: true, value: parsed.data };
}

/** The content as the editor stores it: website addresses normalized the way the editor normalizes them. */
function stored(content: QrContent): QrContent {
  if (content.type === "website") return { ...content, url: normalizeUrl(content.url) };
  if (content.type === "contact" && content.website?.trim()) return { ...content, website: normalizeUrl(content.website) };
  return content;
}

/*
 * HEY-165 / QR-22.06: Idempotency-Key for create. A key belongs to one account and one operation ("create_qr"). Within
 * the retention window, the same key with an equivalent validated request returns the original 201 (same code and
 * layout ids) without creating anything or taking a draft slot; a different request with that key is refused
 * (idempotency_key_reused). Only a successful create is stored, in the same transaction as the code, so a refused or
 * rolled-back attempt leaves nothing and the same key can be retried. Requests with the same key are serialized by an
 * advisory lock, so concurrent matching requests create exactly one code.
 */
export const IDEMPOTENCY_RETENTION_HOURS = 24;
const OPERATION = "create_qr";
/** An Idempotency-Key: 1–255 visible ASCII characters (a UUID is a good choice). */
export const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;

/** The same validated request always hashes the same (object keys sorted; arrays keep their order). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const requestHash = (request: CreateQrRequest) =>
  createHash("sha256")
    .update(canonical({ ...request, content: stored(request.content as QrContent) }))
    .digest("hex");

/**
 * Creates the code and its layouts for `userId` (the verified key's owner, never the request). Always a new code: no
 * code id, layout ids or claim key are passed, so nothing existing is read or changed. Saved as a draft; activation,
 * the short link and entitlements stay with the existing flows.
 */
export async function createQrForOwner(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  body: unknown,
  prepare?: PrepareRecord,
  idempotencyKey?: string,
): Promise<CreateQrOutcome> {
  const request = readCreateRequest(body);
  if (!request.ok) return { ok: false, error: "invalid_request", details: request.details };
  if (idempotencyKey === undefined) return save(db, userId, request.value, prepare);

  const hash = requestHash(request.value);
  const where = and(
    eq(schema.apiIdempotencyKey.userId, userId),
    eq(schema.apiIdempotencyKey.operation, OPERATION),
    eq(schema.apiIdempotencyKey.key, idempotencyKey),
  );
  return db.transaction(async (tx) => {
    // One request per (account, key) at a time: a concurrent duplicate waits here, then replays what this one stored.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`idem:${OPERATION}:${userId}:${idempotencyKey}`}))`);
    const [stored] = await tx
      .select({
        requestHash: schema.apiIdempotencyKey.requestHash,
        response: schema.apiIdempotencyKey.response,
        fresh: sql<boolean>`${schema.apiIdempotencyKey.createdAt} > now() - make_interval(hours => ${IDEMPOTENCY_RETENTION_HOURS})`,
      })
      .from(schema.apiIdempotencyKey)
      .where(where);
    if (stored?.fresh) {
      if (stored.requestHash !== hash) return { ok: false, error: "idempotency_key_reused" } as const;
      return { ok: true, qrCodeId: stored.response.id, layoutIds: stored.response.layouts.map((l) => l.id), replayed: true } as const;
    }
    // Absent, or past the retention window: a new create (an expired row is replaced).
    if (stored) await tx.delete(schema.apiIdempotencyKey).where(where);
    const result = await save(tx, userId, request.value, prepare);
    if (!result.ok) return result;
    await tx.insert(schema.apiIdempotencyKey).values({
      userId,
      operation: OPERATION,
      key: idempotencyKey,
      requestHash: hash,
      qrCodeId: result.qrCodeId,
      response: { id: result.qrCodeId, status: "draft", layouts: result.layoutIds.map((id) => ({ id })) },
    });
    return result;
  });
}

/** The editor's save of a validated request, as a new draft. */
async function save(
  db: Parameters<typeof saveQrWithLayouts>[0],
  userId: string,
  value: CreateQrRequest,
  prepare: PrepareRecord | undefined,
): Promise<CreateQrOutcome> {
  const { name, mode, content, destination, layouts } = value;
  const result = await saveQrWithLayouts(
    db,
    userId,
    {
      name,
      model: mode,
      content: stored(content as QrContent),
      ...(destination === undefined ? {} : { destination }),
      layouts: layouts.map((l) => ({ name: l.name, layout: l.layout, ...(l.editor === undefined ? {} : { editor: l.editor }) })),
    },
    prepare,
  );
  if (result.ok) return { ok: true, qrCodeId: result.data.qrCodeId, layoutIds: result.data.layoutIds };
  if (result.error === "draft_limit") return { ok: false, error: "draft_limit" };
  if (result.error === "too_long") return { ok: false, error: "content_too_long" };
  if ("field" in result)
    return { ok: false, error: "invalid_request", details: [{ path: "destination", message: `Invalid destination (${result.problem})` }] };
  // "invalid" (mode and content were checked above): a layout isn't a valid design record, or its logo isn't usable.
  return {
    ok: false,
    error: "invalid_request",
    details: [{ path: "layouts", message: "A layout isn't a valid design (see docs/API_V1.md)" }],
  };
}
