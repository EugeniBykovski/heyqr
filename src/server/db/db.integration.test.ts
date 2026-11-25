/**
 * Real-Postgres checks for migrations, seeding and the health check.
 * Runs when TEST_DATABASE_URL points at a database whose name ends in "_test" (CI, `pnpm test:db`); skipped otherwise.
 * The test drops and recreates that database's schema, so it never runs against anything else.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "../../entities/qr/model/design";
import { designSettingsOf, readLayoutRecord } from "../../entities/qr/model/design-schema";
import { RESTORE_WINDOW_MS, restoreQrCodes, softDeleteQrCodes } from "../qr/delete-qr";
import { cleanupLogos, referencedAssets, resolveLogos, storeLogos, type LogoStore } from "../qr/logo-assets";
import { authorizedLogo, ownedLayout } from "../qr/file-access";
import { fulfillCheckout, processCheckoutEvent } from "../billing/fulfillment";
import { processRefundEvent, unusedPackCredits, type PaymentLookup } from "../billing/refunds";
import { awaitingFulfillment, singleQrCheckout, type CheckoutPort, type SessionLookup } from "../billing/single-order";
import { renameQrCode } from "../qr/rename-qr";
import { changeDestination, destinationHistory } from "../qr/destination";
import { assignShortCode, SHORT_CODE_ATTEMPTS, ShortCodeExhaustedError } from "../qr/short-code";
import { saveQrWithLayouts } from "../qr/save-qr";
import { addLayoutFrom, copyLayout, layoutRevision, removeLayout, updateLayoutDesign, type PrepareRecord } from "../qr/update-layout";
import { activateTrialCode, startTrial, trialCode, trialCovers, trialPhase } from "../billing/trial";
import { pauseDynamicCode, resumeDynamicCode } from "../billing/pause";
import { bindStripeCustomer, customerIdempotencyKey, storedCustomer, type CustomerCreate } from "../billing/customer";
import { applySubscriptionEvent, type SubscriptionEvent } from "../billing/subscriptions";
import { canDownloadCode, resolveShortLink } from "../billing/access";
import { apiKeyOwner, createApiKey, generateApiKey, listApiKeys, revokeApiKey } from "../api-keys/keys";
import { readLayoutForOwner } from "../api/v1/layouts";
import { authorizeApiExport } from "../api/v1/export";
import type * as Sdk from "@heyqr/sdk";
import {
  HeyQrClient,
  HeyQrError,
  isIdempotencyConflict,
  isRevisionConflict,
  type FetchLike,
  type UpdateDestinationError,
} from "@heyqr/sdk";
import { HeyQrRateLimitError } from "@heyqr/sdk";
import { createQrForOwner } from "../api/v1/create-qr";
import { takeRequest, WINDOW_SECONDS } from "../api/v1/rate-limit";
import { hasScans, incrementScan, ownerScanSummary, scansByDay, utcDay } from "../qr/scans";
import {
  accountUsage,
  activateDynamicCode,
  applyPrintPackAllowance,
  currentPlan,
  hasPlanAccess,
  overdueSubscription,
  type AccessFields,
  convertToStatic,
  creditBalance,
  grantPackCredits,
  unlockStatic,
} from "../billing/allowances";
import { checkDatabase, EXPECTED_MIGRATIONS, REQUIRED_TABLES } from "./check";
import { SEED_SCAN_DAYS, seedFixtures } from "./fixtures";
import { runMigrations } from "./migrator";
import * as schema from "./schema";
import { assertAllowed } from "./target";
import { DRAFT_LIMIT, PLANS, SCAN_MONITOR_THRESHOLDS } from "../../shared/config/catalog-core";
import { newId } from "./ids";
import { publishHosted, publicHostedContent, saveHostedDraft, hostedStatus } from "../qr/hosted";
import { checkPdf, storeHostedContent, storePdf } from "../qr/hosted-assets";
import { publicHostedFile, REPORTS_PER_HOUR, reportsFor, submitDeveloperNotify, submitReport } from "../qr/hosted-public";
import { emptyHostedContent, sampleHostedContent, type HostedContent } from "../../entities/qr/model/hosted";

const url = process.env.TEST_DATABASE_URL;

/*
 * HEY-155: the public API route runs here against this file's database. Only modules that import the app's db module
 * (the route and the dashboard's listQrCodes) see the mock; everything else in this file passes its own db.
 */
const apiDb = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/server/db", async () => ({
  get db() {
    return apiDb.current;
  },
  schema: await import("./schema"),
}));
vi.mock("server-only", () => ({}));
// HEY-178: the limiter as it is, except that its tests can set the clock the routes use.
const limiterClock = vi.hoisted(() => ({ now: undefined as Date | undefined, timeoutMs: undefined as number | undefined }));
vi.mock("../api/v1/rate-limit", async (original) => {
  const real = await original<typeof import("../api/v1/rate-limit")>();
  const takeRequest: typeof real.takeRequest = (d, userId, bucket, options) =>
    real.takeRequest(d, userId, bucket, {
      ...(limiterClock.now ? { now: limiterClock.now } : {}),
      ...(limiterClock.timeoutMs ? { timeoutMs: limiterClock.timeoutMs } : {}),
      ...options,
    });
  return { ...real, takeRequest };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/storage/s3", () => ({ logoStore: () => null }));
// HEY-156: what the printed code holds, as the app computes it (without the app's environment module).
vi.mock("@/server/qr/export", async () => {
  const { encodePayload } = await import("@heyqr/qr-core");
  const { PREVIEW_SLUG, shortLinkUrl } = await import("../../shared/lib/short-link");
  return {
    encodedValue: (qr: { model: string; content: Parameters<typeof encodePayload>[0]; shortCode: string | null }) =>
      qr.model === "dynamic" ? shortLinkUrl("https://heyqr.test/r", qr.shortCode ?? PREVIEW_SLUG) : encodePayload(qr.content),
  };
});

/**
 * Change destination as a tab that has just opened the code: from its current destination revision (HEY-128). Read
 * without the owner check, so another account's attempt still reaches changeDestination's own ownership check.
 */
let subscriptionEvents = 0;
/**
 * One delivery of a subscription lifecycle event (a fresh event id) whose payload is also Stripe's current state, as
 * when events arrive in order. HEY-134's own tests drive the event and the current state separately.
 */
async function deliverSubscription(
  db: ReturnType<typeof drizzle<typeof schema>>,
  sub: SubscriptionEvent,
  planForPrice: (priceId: string | undefined) => "starter" | "studio" | null = () => null,
) {
  const done = await applySubscriptionEvent(
    db,
    { id: `evt_sub_${++subscriptionEvents}_${sub.id}`, type: "customer.subscription.updated", subscription: sub },
    { planForPrice, current: async () => sub },
  );
  return done.duplicate ? { duplicate: true } : done.outcome;
}

async function changeFresh(db: ReturnType<typeof drizzle<typeof schema>>, userId: string, qrCodeId: string, raw: unknown) {
  const row = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, qrCodeId), columns: { destinationRevision: true } });
  return changeDestination(db, userId, qrCodeId, raw, row?.destinationRevision ?? 0);
}

describe.skipIf(!url)("database (real PostgreSQL)", () => {
  let pool: Pool;
  const count = async (table: string) => Number((await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n);

  beforeAll(async () => {
    if (!url) return;
    assertAllowed("reset", "test", url);
    pool = new Pool({ connectionString: url, max: 2 });
    // Removes the app's objects only: the drizzle schema plus the tables, sequences and enum types the test role owns
    // in "public". Works whether the role is a plain owner (local) or the container superuser (CI), where
    // `drop owned by` fails because a superuser also owns system objects.
    await pool.query(`
      drop schema if exists drizzle cascade;
      do $$
      declare r record;
      begin
        for r in select tablename as name from pg_tables where schemaname = 'public' and tableowner = current_user loop
          execute format('drop table if exists public.%I cascade', r.name);
        end loop;
        for r in select sequencename as name from pg_sequences where schemaname = 'public' and sequenceowner = current_user loop
          execute format('drop sequence if exists public.%I cascade', r.name);
        end loop;
        for r in select t.typname as name from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typtype = 'e' and pg_get_userbyid(t.typowner) = current_user loop
          execute format('drop type if exists public.%I cascade', r.name);
        end loop;
      end $$;
    `);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("reports a fresh database as not ready", async () => {
    const result = await checkDatabase(pool);
    expect(result).toMatchObject({ ok: false, reason: "schema_missing" });
  });

  it("applies every committed migration to a fresh database, and a rerun applies nothing", async () => {
    expect(await runMigrations(url as string)).toEqual({ before: 0, after: EXPECTED_MIGRATIONS });
    expect(await runMigrations(url as string)).toEqual({ before: EXPECTED_MIGRATIONS, after: EXPECTED_MIGRATIONS });
    expect(await checkDatabase(pool)).toEqual({
      ok: true,
      migrations: { applied: EXPECTED_MIGRATIONS, expected: EXPECTED_MIGRATIONS },
      tables: REQUIRED_TABLES.length,
    });
  });

  it("serialises concurrent migration runs", async () => {
    const runs = await Promise.all([runMigrations(url as string), runMigrations(url as string)]);
    expect(runs.every((r) => r.after === EXPECTED_MIGRATIONS)).toBe(true);
  });

  it("seeds once, reruns without duplicates, and leaves unrelated rows alone", async () => {
    const db = drizzle(pool, { schema, casing: "snake_case" });
    await seedFixtures(db);
    const first = {
      users: await count('"user"'),
      codes: await count("qr_code"),
      layouts: await count("qr_layout"),
      scans: await count("scan_daily"),
    };
    expect(first).toEqual({ users: 1, codes: 2, layouts: 2, scans: SEED_SCAN_DAYS });

    await pool.query(
      `insert into "user" (id, name, email, email_verified) values ('real-user', 'Someone Else', 'someone@example.org', false)`,
    );
    await pool.query(`update qr_code set name = 'Renamed by the user' where id = 'seed-static'`);
    await seedFixtures(db);

    expect({
      users: await count('"user"'),
      codes: await count("qr_code"),
      layouts: await count("qr_layout"),
      scans: await count("scan_daily"),
    }).toEqual({
      ...first,
      users: 2,
    });
    expect((await pool.query(`select name from qr_code where id = 'seed-static'`)).rows[0].name).toBe("Renamed by the user");
    expect((await pool.query(`select name from "user" where id = 'real-user'`)).rows[0].name).toBe("Someone Else");
  });
});

/*
 * QR codes and their design variants (HEY-11). Runs after the block above has migrated the test database.
 * A code holds what it encodes and who owns it; each qr_layout row is one named design variant of it.
 */
describe.skipIf(!url)("QR codes and design variants (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey11-owner", name: "Owner", email: "owner@hey11.test" };
  const other = { id: "hey11-other", name: "Other", email: "other@hey11.test" };
  const card = designToLayout({
    ...DEFAULT_DESIGN,
    fg: "#1F5C45",
    bg: "#EEF6F0",
    pattern: "dot",
    preset: "caption",
    caption: "Scan to join",
  });
  const poster = designToLayout({ ...DEFAULT_DESIGN, fg: "#8C2F4B", preset: "frame", frameStyle: "bubble", caption: "See the menu" });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("round-trips a code with its payload and ordered design variants", async () => {
    await db.transaction(async (tx) => {
      await tx.insert(schema.qrCode).values({
        id: "hey11-code",
        userId: owner.id,
        name: "Café Wi-Fi",
        content: { type: "wifi", ssid: "Little Fern Guest", security: "WPA", password: "fern-latte-7" },
      });
      await tx.insert(schema.qrLayout).values([
        { id: "hey11-poster", qrCodeId: "hey11-code", name: "Poster", design: { schemaVersion: 1, layout: poster }, sortOrder: 1 },
        { id: "hey11-card", qrCodeId: "hey11-code", name: "Table tent", design: { schemaVersion: 1, layout: card }, sortOrder: 0 },
      ]);
    });

    const loaded = await db.query.qrCode.findFirst({
      where: (q, { and, eq }) => and(eq(q.id, "hey11-code"), eq(q.userId, owner.id)),
      with: { layouts: { orderBy: (l, { asc }) => asc(l.sortOrder) } },
    });
    expect(loaded).toMatchObject({ name: "Café Wi-Fi", model: "static", status: "draft", shortCode: null, purchasedAt: null });
    expect(loaded?.content).toEqual({ type: "wifi", ssid: "Little Fern Guest", security: "WPA", password: "fern-latte-7" });
    expect(loaded?.layouts.map((l) => l.name)).toEqual(["Table tent", "Poster"]);
    // The jsonb design comes back exactly as saved, so a variant renders the same after a reload.
    expect(loaded?.layouts[0]?.design.layout).toEqual(card);
    expect(loaded?.layouts[1]?.design.layout).toEqual(poster);
  });

  it("keeps a code private to its owner", async () => {
    const asOther = await db.query.qrCode.findFirst({
      where: (q, { and, eq }) => and(eq(q.id, "hey11-code"), eq(q.userId, other.id)),
    });
    expect(asOther).toBeUndefined();
  });

  it("rejects a variant for a code that does not exist", async () => {
    await expect(
      db
        .insert(schema.qrLayout)
        .values({ id: "hey11-orphan", qrCodeId: "no-such-code", name: "Orphan", design: { schemaVersion: 1, layout: card } }),
    ).rejects.toMatchObject({ cause: { code: "23503", constraint: "qr_layout_qr_code_id_qr_code_id_fk" } });
  });

  it("requires every variant to name its code", async () => {
    await expect(
      pool.query(`insert into qr_layout (id, name, design) values ('hey11-null', 'No code', '{}'::jsonb)`),
    ).rejects.toMatchObject({
      code: "23502",
      column: "qr_code_id",
    });
  });

  it("deletes a code's variants and their export cache with the code, and a user's codes with the user", async () => {
    await db.insert(schema.exportFile).values({
      id: "hey11-file",
      layoutId: "hey11-card",
      format: "png",
      pixelWidth: 1024,
      contentHash: "abc",
      storageKey: "exports/hey11.png",
    });
    await db.delete(schema.qrCode).where(eq(schema.qrCode.id, "hey11-code"));
    expect(await db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, "hey11-code") })).toEqual([]);
    expect(await db.query.exportFile.findFirst({ where: (f, { eq }) => eq(f.id, "hey11-file") })).toBeUndefined();

    await db.insert(schema.qrCode).values({ id: "hey11-second", userId: other.id, name: "Second", content: { type: "text", text: "hi" } });
    await db
      .insert(schema.qrLayout)
      .values({ id: "hey11-second-l", qrCodeId: "hey11-second", name: "Main", design: { schemaVersion: 1, layout: card } });
    await db.delete(schema.user).where(eq(schema.user.id, other.id));
    expect(await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, "hey11-second") })).toBeUndefined();
    expect(await db.query.qrLayout.findFirst({ where: (l, { eq }) => eq(l.id, "hey11-second-l") })).toBeUndefined();
  });
});

/* Versioned design JSON (HEY-12): what the save path writes, and what the read boundary accepts. */
describe.skipIf(!url)("versioned design records (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey12-owner", name: "Owner", email: "owner@hey12.test" };
  const design = {
    ...DEFAULT_DESIGN,
    fg: "#8C2F4B",
    pattern: "rounded" as const,
    preset: "frame" as const,
    frameStyle: "bubble" as const,
    caption: "See the menu",
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("saves a variant through saveQrWithLayouts as schemaVersion 1 and reads it back unchanged", async () => {
    const result = await saveQrWithLayouts(db, owner.id, {
      name: "Menu sticker",
      model: "dynamic",
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      layouts: [{ name: "Sticker", layout: designToLayout(design), editor: designSettingsOf(design) }],
    });
    expect(result.ok).toBe(true);
    const layoutId = result.ok ? result.data.layoutIds[0] : "";

    const { rows } = await pool.query(`select design from qr_layout where id = $1`, [layoutId]);
    const stored = rows[0].design;
    expect(stored.schemaVersion).toBe(1);
    expect(stored.editor).toEqual(designSettingsOf(design));
    expect(readLayoutRecord(stored)).toEqual({
      ok: true,
      from: "current",
      value: { schemaVersion: 1, layout: designToLayout(design), editor: designSettingsOf(design) },
    });
  });

  it("refuses to save a variant that doesn't match the contract", async () => {
    const result = await saveQrWithLayouts(db, owner.id, {
      name: "Broken",
      model: "static",
      content: { type: "text", text: "hi" },
      layouts: [{ name: "Bad", layout: { preset: "qr" } }],
    });
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect((await pool.query(`select count(*)::int as n from qr_code where name = 'Broken'`)).rows[0].n).toBe(0);
  });

  it("saving the same guest draft again returns the code already saved, with no duplicate (HEY-77)", async () => {
    const draft = {
      name: "Claimed menu",
      model: "static" as const,
      content: { type: "website" as const, url: "https://littlefern.cafe/hey77" },
      layouts: [{ name: "Vertical card", layout: designToLayout(design), editor: designSettingsOf(design) }],
      claimKey: "hey77claimkey0000000001",
    };
    const first = await saveQrWithLayouts(db, owner.id, draft);
    // A refresh or a retry after a lost response, and two tabs at once, all resolve to that code.
    const again = await saveQrWithLayouts(db, owner.id, draft);
    const [tabA, tabB] = await Promise.all([saveQrWithLayouts(db, owner.id, draft), saveQrWithLayouts(db, owner.id, draft)]);
    expect(first.ok).toBe(true);
    for (const r of [again, tabA, tabB]) expect(r).toEqual(first);
    const { rows } = await pool.query(
      `select q.id, q.user_id, q.guest_claim_key, count(l.id)::int as layouts from qr_code q join qr_layout l on l.qr_code_id = q.id
       where q.name = 'Claimed menu' group by q.id`,
    );
    expect(rows).toEqual([{ id: first.ok ? first.data.qrCodeId : "", user_id: owner.id, guest_claim_key: draft.claimKey, layouts: 1 }]);
  });

  it("a claim key never finds or changes another account's code (HEY-77)", async () => {
    const other = { id: "hey77-other", name: "Other", email: "other@hey77.test" };
    await db.insert(schema.user).values(other).onConflictDoNothing();
    try {
      const draft = {
        name: "Ownership check",
        model: "static" as const,
        content: { type: "text" as const, text: "hey77" },
        layouts: [{ name: "QR only", layout: designToLayout(design), editor: designSettingsOf(design) }],
        claimKey: "hey77claimkey0000000002",
      };
      const mine = await saveQrWithLayouts(db, owner.id, draft);
      // The same key from another account is that account's own new draft; the first code keeps its owner.
      const theirs = await saveQrWithLayouts(db, other.id, { ...draft, name: "Their copy" });
      expect(mine.ok && theirs.ok && mine.data.qrCodeId !== theirs.data.qrCodeId).toBe(true);
      // Updating the first code by id from the other account is refused.
      const hijack = await saveQrWithLayouts(db, other.id, { ...draft, qrCodeId: mine.ok ? mine.data.qrCodeId : "", name: "Hijacked" });
      expect(hijack).toEqual({ ok: false, error: "not_found" });
      const { rows } = await pool.query(`select name, user_id from qr_code where id = $1`, [mine.ok ? mine.data.qrCodeId : ""]);
      expect(rows).toEqual([{ name: "Ownership check", user_id: owner.id }]);
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, other.id));
    }
  });

  it("a deleted code frees its claim key: saving the draft again makes a new code (HEY-77)", async () => {
    const draft = {
      name: "Deleted then saved",
      model: "static" as const,
      content: { type: "text" as const, text: "hey77 deleted" },
      layouts: [{ name: "QR only", layout: designToLayout(design), editor: designSettingsOf(design) }],
      claimKey: "hey77claimkey0000000003",
    };
    const first = await saveQrWithLayouts(db, owner.id, draft);
    await pool.query(`update qr_code set deleted_at = now() where id = $1`, [first.ok ? first.data.qrCodeId : ""]);
    const second = await saveQrWithLayouts(db, owner.id, draft);
    expect(second.ok && first.ok && second.data.qrCodeId !== first.data.qrCodeId).toBe(true);
  });

  it("saves dynamic website codes and refuses dynamic codes of other types (HEY-13)", async () => {
    const layouts = [{ name: "Main", layout: designToLayout(design), editor: designSettingsOf(design) }];
    const dynamicSite = await saveQrWithLayouts(db, owner.id, {
      name: "Dynamic site",
      model: "dynamic",
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      layouts,
    });
    expect(dynamicSite.ok).toBe(true);
    const dynamicWifi = await saveQrWithLayouts(db, owner.id, {
      name: "Dynamic Wi-Fi",
      model: "dynamic",
      content: { type: "wifi", ssid: "Guest", security: "WPA" },
      layouts,
    });
    expect(dynamicWifi).toEqual({ ok: false, error: "invalid" });
    const { rows } = await pool.query(`select name, model from qr_code where user_id = $1 and name like 'Dynamic%' order by name`, [
      owner.id,
    ]);
    expect(rows).toEqual([{ name: "Dynamic site", model: "dynamic" }]);
  });

  it("reads legacy rows written before versioning, and reports rows from a newer version", async () => {
    await pool.query(
      `insert into qr_code (id, user_id, name, content) values ('hey12-legacy', $1, 'Legacy', '{"type":"text","text":"hi"}')`,
      [owner.id],
    );
    await pool.query(
      `insert into qr_layout (id, qr_code_id, name, design, sort_order) values ('hey12-old', 'hey12-legacy', 'Old', $1, 0), ('hey12-new', 'hey12-legacy', 'Future', $2, 1)`,
      [JSON.stringify({ layout: designToLayout(design) }), JSON.stringify({ schemaVersion: 2, layout: designToLayout(design) })],
    );
    const { rows } = await pool.query(`select id, design from qr_layout where qr_code_id = 'hey12-legacy' order by sort_order`);
    expect(readLayoutRecord(rows[0].design)).toEqual({
      ok: true,
      from: "legacy",
      value: { schemaVersion: 1, layout: designToLayout(design) },
    });
    expect(readLayoutRecord(rows[1].design)).toEqual({ ok: false, reason: "unsupported", version: 2 });
  });
});

/* Owner indexes and owner scoping (HEY-14): the indexes the owner queries rely on, and two accounts kept apart. */
describe.skipIf(!url)("owner indexes and owner-scoped access (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ana = { id: "hey14-ana", name: "Ana", email: "ana@hey14.test" };
  const ben = { id: "hey14-ben", name: "Ben", email: "ben@hey14.test" };
  const design = { ...DEFAULT_DESIGN, fg: "#1F5C45" };
  const layouts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Variant ${i + 1}`, layout: designToLayout(design), editor: designSettingsOf(design) }));
  /** Same shape as listQrCodes: the owner's codes, newest first, with their first variant. */
  const list = (userId: string) =>
    db.query.qrCode.findMany({
      where: (q, { eq }) => eq(q.userId, userId),
      orderBy: (q, { desc }) => desc(q.updatedAt),
      with: { layouts: { orderBy: (l, { asc }) => asc(l.sortOrder), limit: 1 } },
    });
  /** Same shape as getQrCode: one code, only for its owner, with all variants. */
  const get = (userId: string, id: string) =>
    db.query.qrCode.findFirst({
      where: (q, { and, eq }) => and(eq(q.id, id), eq(q.userId, userId)),
      with: { layouts: { orderBy: (l, { asc }) => asc(l.sortOrder) } },
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([ana, ben]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [ana.id, ben.id]));
    await pool?.end();
  });

  it("has the owner list index and the variant index the queries use", async () => {
    const { rows } = await pool.query(
      `select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname in ('qr_code_user_idx', 'qr_layout_qr_idx') order by indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(["qr_code_user_idx", "qr_layout_qr_idx"]);
    expect(rows[0].indexdef).toContain("(user_id, updated_at)");
    expect(rows[1].indexdef).toContain("(qr_code_id, sort_order)");
  });

  it("shows each account only its own codes and variants", async () => {
    const a1 = await saveQrWithLayouts(db, ana.id, {
      name: "Ana menu",
      model: "static",
      content: { type: "text", text: "a" },
      layouts: layouts(2),
    });
    const a2 = await saveQrWithLayouts(db, ana.id, {
      name: "Ana card",
      model: "static",
      content: { type: "text", text: "b" },
      layouts: layouts(1),
    });
    const b1 = await saveQrWithLayouts(db, ben.id, {
      name: "Ben flyer",
      model: "static",
      content: { type: "text", text: "c" },
      layouts: layouts(3),
    });
    if (!a1.ok || !a2.ok || !b1.ok) throw new Error("fixture save failed");

    expect((await list(ana.id)).map((q) => q.name).sort()).toEqual(["Ana card", "Ana menu"]);
    expect((await list(ben.id)).map((q) => q.name)).toEqual(["Ben flyer"]);
    expect((await get(ana.id, a1.data.qrCodeId))?.layouts.map((l) => l.name)).toEqual(["Variant 1", "Variant 2"]);
    expect((await get(ben.id, b1.data.qrCodeId))?.layouts).toHaveLength(3);
  });

  it("does not let one account read or update the other's code", async () => {
    const [anaCode] = await list(ana.id);
    if (!anaCode) throw new Error("missing fixture");
    expect(await get(ben.id, anaCode.id)).toBeUndefined();

    // Ben tries to overwrite Ana's code through the real save path: nothing changes, variants included.
    const hijack = await saveQrWithLayouts(db, ben.id, {
      qrCodeId: anaCode.id,
      name: "hijacked",
      model: "static",
      content: { type: "text", text: "evil" },
      layouts: layouts(1),
    });
    expect(hijack).toEqual({ ok: false, error: "not_found" });
    const after = await get(ana.id, anaCode.id);
    expect(after?.name).toBe(anaCode.name);
    expect(after?.content).toEqual(anaCode.content);
    expect(after?.layouts.length).toBeGreaterThan(0);

    // A direct owner-scoped update (as in renameQr) by the wrong owner touches no rows.
    const updated = await db
      .update(schema.qrCode)
      .set({ name: "hijacked" })
      .where(and(eq(schema.qrCode.id, anaCode.id), eq(schema.qrCode.userId, ben.id)))
      .returning({ id: schema.qrCode.id });
    expect(updated).toEqual([]);
  });
});

/* Delete from My QR codes (design 4.10–4.12): soft delete for the owner only, Undo within the restore window. */
describe.skipIf(!url)("delete and undo QR codes (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "del-owner", name: "Owner", email: "owner@del.test" };
  const other = { id: "del-other", name: "Other", email: "other@del.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const live = (userId: string) =>
    db.query.qrCode.findMany({ where: (q, { and, eq, isNull }) => and(eq(q.userId, userId), isNull(q.deletedAt)) });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("hides deleted codes, keeps their variants for Undo, and only touches the owner's rows", async () => {
    const a = await saveQrWithLayouts(db, owner.id, { name: "Menu", model: "static", content: { type: "text", text: "a" }, layouts });
    const b = await saveQrWithLayouts(db, owner.id, { name: "Card", model: "static", content: { type: "text", text: "b" }, layouts });
    if (!a.ok || !b.ok) throw new Error("fixture save failed");

    expect(await softDeleteQrCodes(db, other.id, [a.data.qrCodeId])).toEqual([]);
    expect(await softDeleteQrCodes(db, owner.id, [a.data.qrCodeId, b.data.qrCodeId])).toHaveLength(2);
    expect(await live(owner.id)).toEqual([]);
    const variants = await db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, a.data.qrCodeId) });
    expect(variants).toHaveLength(1);

    // A deleted code can't be saved over either.
    const resave = await saveQrWithLayouts(db, owner.id, {
      qrCodeId: a.data.qrCodeId,
      name: "x",
      model: "static",
      content: { type: "text", text: "x" },
      layouts,
    });
    expect(resave).toEqual({ ok: false, error: "not_found" });

    expect(await restoreQrCodes(db, other.id, [a.data.qrCodeId])).toEqual([]);
    expect((await restoreQrCodes(db, owner.id, [a.data.qrCodeId, b.data.qrCodeId])).sort()).toEqual(
      [a.data.qrCodeId, b.data.qrCodeId].sort(),
    );
    expect((await live(owner.id)).map((q) => q.name).sort()).toEqual(["Card", "Menu"]);
    const before = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, a.data.qrCodeId) });
    await softDeleteQrCodes(db, owner.id, [a.data.qrCodeId]);
    await restoreQrCodes(db, owner.id, [a.data.qrCodeId]);
    const after = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, a.data.qrCodeId) });
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("refuses Undo after the restore window", async () => {
    const c = await saveQrWithLayouts(db, owner.id, { name: "Old", model: "static", content: { type: "text", text: "c" }, layouts });
    if (!c.ok) throw new Error("fixture save failed");
    const deletedAt = new Date(Date.now() - RESTORE_WINDOW_MS - 60_000);
    await softDeleteQrCodes(db, owner.id, [c.data.qrCodeId], deletedAt);
    expect(await restoreQrCodes(db, owner.id, [c.data.qrCodeId])).toEqual([]);
  });
});

/* HEY-24: the server never stores a static code its QR can't hold (with every variant's layout). */
describe.skipIf(!url)("capacity on save (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "cap-owner", name: "Owner", email: "owner@cap.test" };
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("refuses too-long static content, also when only the logo variant overflows", async () => {
    const plain = { name: "Plain", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) };
    const logoDesign = { ...DEFAULT_DESIGN, logo: { kind: "icon", icon: "coffee" } } as const;
    const logo = { name: "Logo", layout: designToLayout(logoDesign), editor: designSettingsOf(logoDesign) };
    const text = (n: number) => ({ type: "text", text: "x".repeat(n) }) as const;

    expect(await saveQrWithLayouts(db, owner.id, { name: "Too long", model: "static", content: text(667), layouts: [plain] })).toEqual({
      ok: false,
      error: "too_long",
    });
    // 500 bytes fit at M but not at H: the variant with a center logo makes the whole save fail.
    expect(await saveQrWithLayouts(db, owner.id, { name: "Mixed", model: "static", content: text(500), layouts: [plain, logo] })).toEqual({
      ok: false,
      error: "too_long",
    });
    expect((await saveQrWithLayouts(db, owner.id, { name: "Fits", model: "static", content: text(666), layouts: [plain] })).ok).toBe(true);
    // Dynamic codes encode only their short link.
    const long = { type: "website", url: `https://example.com/${"a".repeat(900)}` } as const;
    expect(
      (await saveQrWithLayouts(db, owner.id, { name: "Dyn", model: "dynamic", content: long, destination: long.url, layouts: [logo] })).ok,
    ).toBe(true);
    expect(await db.query.qrCode.findMany({ where: (q, { eq }) => eq(q.userId, owner.id) })).toHaveLength(2);
  });
});

describe.skipIf(!url)("edit one saved layout (HEY-45, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "edit-owner", name: "Owner", email: "owner@edit.test" };
  const other = { id: "edit-other", name: "Other", email: "other@edit.test" };
  const card = { ...DEFAULT_DESIGN, preset: "caption" as const, caption: "Portfolio" };
  const sticker = { ...DEFAULT_DESIGN, preset: "frame" as const, caption: "Menu" };
  const encoded = (qr: { model: string; shortCode: string | null; content: unknown }) =>
    qr.model === "dynamic" ? `https://hey.qr/${qr.shortCode ?? ""}` : "https://littlefern.cafe/menu";
  const rows = (qrCodeId: string) =>
    db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, qrCodeId), orderBy: (l, { asc }) => asc(l.sortOrder) });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("replaces only that layout's design; the code, its payment, short link, destination and sibling layouts stay", async () => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Café",
      model: "dynamic",
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      destination: "https://littlefern.cafe/menu",
      layouts: [
        { name: "Portfolio card", layout: designToLayout(card), editor: designSettingsOf(card) },
        { name: "Menu sticker", layout: designToLayout(sticker), editor: designSettingsOf(sticker) },
      ],
    });
    if (!saved.ok) throw new Error("save failed");
    const { qrCodeId, layoutIds } = saved.data;
    await db
      .update(schema.qrCode)
      .set({ shortCode: "m4Kp7", status: "active", previousDestination: "https://old.example" })
      .where(eq(schema.qrCode.id, qrCodeId));
    const qrBefore = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, qrCodeId) });
    const [cardBefore, stickerBefore] = await rows(qrCodeId);

    const edited = { ...card, captionFont: "fraunces" as const, captionWeight: 500 as const, captionSize: 52 };
    const result = await updateLayoutDesign(
      db,
      owner.id,
      { qrCodeId, layoutId: layoutIds[0] ?? "", layout: designToLayout(edited), editor: designSettingsOf(edited) },
      encoded,
    );
    expect(result).toMatchObject({ ok: true, data: { qrCodeId, layoutId: layoutIds[0] } });

    const [cardAfter, stickerAfter] = await rows(qrCodeId);
    expect((await rows(qrCodeId)).map((l) => l.id)).toEqual(layoutIds); // no new layout, same ids and order
    expect(cardAfter?.name).toBe("Portfolio card");
    const read = readLayoutRecord(cardAfter?.design);
    expect(read.ok && [read.value.layout.caption.font, read.value.layout.caption.weight, read.value.layout.caption.size]).toEqual([
      "fraunces",
      500,
      52,
    ]);
    expect(read.ok && [read.value.editor?.captionFont, read.value.editor?.captionWeight, read.value.editor?.captionSize]).toEqual([
      "fraunces",
      500,
      52,
    ]);
    expect(stickerAfter?.design).toEqual(stickerBefore?.design); // sibling untouched
    expect(cardBefore?.id).toBe(cardAfter?.id);
    const qrAfter = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, qrCodeId) });
    expect(qrAfter && { ...qrAfter, updatedAt: null }).toEqual(qrBefore && { ...qrBefore, updatedAt: null });
    expect(await db.query.qrCode.findMany({ where: (q, { eq }) => eq(q.userId, owner.id) })).toHaveLength(1);
  });

  it("New layout from this one: adds a named layout after the others; the code and its layouts stay; owner only", async () => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Café",
      model: "static",
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      layouts: [
        { name: "Portfolio card", layout: designToLayout(card), editor: designSettingsOf(card) },
        { name: "Menu sticker", layout: designToLayout(sticker), editor: designSettingsOf(sticker) },
      ],
    });
    if (!saved.ok) throw new Error("save failed");
    const { qrCodeId, layoutIds } = saved.data;
    const before = await rows(qrCodeId);
    const qrBefore = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, qrCodeId) });
    const edited = { ...card, preset: "vertical" as const, fg: "#1F4D3A" };
    let n = 0;
    const result = await addLayoutFrom(
      db,
      owner.id,
      { qrCodeId, name: "  Poster  ", layout: designToLayout(edited), editor: designSettingsOf(edited) },
      encoded,
      () => `new-layout-${++n}`,
    );
    expect(result).toEqual({ ok: true, data: { layoutId: "new-layout-1" } });
    const after = await rows(qrCodeId);
    expect(after.map((l) => [l.id, l.name])).toEqual([...layoutIds.map((id, i) => [id, before[i]?.name]), ["new-layout-1", "Poster"]]);
    expect(after.slice(0, 2).map((l) => l.design)).toEqual(before.map((l) => l.design)); // the others stay as they were
    const read = readLayoutRecord(after[2]?.design);
    expect(read.ok && [read.value.layout.preset, read.value.editor?.fg]).toEqual(["vertical", "#1F4D3A"]);
    const qrAfter = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, qrCodeId) });
    expect(qrAfter && { ...qrAfter, updatedAt: null }).toEqual(qrBefore && { ...qrBefore, updatedAt: null });
    // Another account, a deleted code, an empty name and an invalid design are refused.
    const args = { qrCodeId, name: "X", layout: designToLayout(card), editor: designSettingsOf(card) };
    expect(await addLayoutFrom(db, other.id, args, encoded, () => "nope")).toEqual({ ok: false, error: "not_found" });
    expect(await addLayoutFrom(db, owner.id, { ...args, name: "   " }, encoded, () => "nope")).toEqual({ ok: false, error: "invalid" });
    expect(await addLayoutFrom(db, owner.id, { ...args, layout: { nope: true } }, encoded, () => "nope")).toEqual({
      ok: false,
      error: "invalid",
    });
    await db.update(schema.qrCode).set({ deletedAt: new Date() }).where(eq(schema.qrCode.id, qrCodeId));
    expect(await addLayoutFrom(db, owner.id, args, encoded, () => "nope")).toEqual({ ok: false, error: "not_found" });
    expect(await rows(qrCodeId)).toHaveLength(3);
  });

  it("saving a layout with a name renames only that layout", async () => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Café",
      model: "static",
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      layouts: [
        { name: "Portfolio card", layout: designToLayout(card), editor: designSettingsOf(card) },
        { name: "Menu sticker", layout: designToLayout(sticker), editor: designSettingsOf(sticker) },
      ],
    });
    if (!saved.ok) throw new Error("save failed");
    const { qrCodeId, layoutIds } = saved.data;
    await updateLayoutDesign(
      db,
      owner.id,
      { qrCodeId, layoutId: layoutIds[1] ?? "", layout: designToLayout(sticker), editor: designSettingsOf(sticker), name: " Table tent " },
      encoded,
    );
    expect((await rows(qrCodeId)).map((l) => l.name)).toEqual(["Portfolio card", "Table tent"]);
  });

  it("Starter trial: starts once, one live test Dynamic code with a real short link, owner only", async () => {
    const now = new Date("2026-11-01T10:00:00Z");
    await db.update(schema.user).set({ trialStartedAt: null, trialEndsAt: null }).where(eq(schema.user.id, owner.id));
    expect(await startTrial(db, owner.id, true, now)).toEqual({ ok: false, error: "subscribed" });
    expect(await startTrial(db, owner.id, false, now)).toEqual({ ok: true, endsAt: new Date("2026-11-08T10:00:00Z") });
    expect(await startTrial(db, owner.id, false, now)).toEqual({ ok: false, error: "already_used" });

    const make = async (model: "static" | "dynamic") => {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name: "Trial test",
        model,
        content: { type: "website", url: "https://littlefern.cafe/menu" },
        destination: model === "dynamic" ? "https://littlefern.cafe/menu" : undefined,
        layouts: [{ name: "Card", layout: designToLayout(card), editor: designSettingsOf(card) }],
      });
      if (!saved.ok) throw new Error("save failed");
      return saved.data.qrCodeId;
    };
    const first = await make("dynamic");
    const second = await make("dynamic");
    const stat = await make("static");
    const day2 = new Date("2026-11-02T10:00:00Z");
    expect(await activateTrialCode(db, owner.id, stat, () => "s1", day2)).toEqual({ ok: false, error: "not_dynamic" });
    // Another account with its own trial still can't take this code.
    await startTrial(db, other.id, false, now);
    expect(await activateTrialCode(db, other.id, first, () => "s1", day2)).toEqual({ ok: false, error: "not_found" });
    expect(await activateTrialCode(db, owner.id, first, () => "trial01", day2)).toEqual({ ok: true, shortCode: "trial01" });
    const live = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, first) });
    expect(live && [live.status, live.isTrial, live.shortCode]).toEqual(["active", true, "trial01"]);
    expect(await activateTrialCode(db, owner.id, first, () => "again", day2)).toEqual({ ok: true, shortCode: "trial01" });
    expect(await activateTrialCode(db, owner.id, second, () => "trial02", day2)).toEqual({ ok: false, error: "slot_taken" });
    expect((await trialCode(db, owner.id))?.id).toBe(first);
    // Deleting the test code frees the slot.
    await db.update(schema.qrCode).set({ deletedAt: day2 }).where(eq(schema.qrCode.id, first));
    expect(await activateTrialCode(db, owner.id, second, () => "trial02", day2)).toEqual({ ok: true, shortCode: "trial02" });
    // After the trial no new code can use it.
    expect(await activateTrialCode(db, owner.id, stat, () => "x", new Date("2026-11-09T10:00:00Z"))).toEqual({
      ok: false,
      error: "no_trial",
    });
    await db
      .update(schema.user)
      .set({ trialStartedAt: null, trialEndsAt: null })
      .where(inArray(schema.user.id, [owner.id, other.id]));
  });

  it("refuses another account, a layout of another code, a deleted code and an invalid design", async () => {
    const make = async (name: string) => {
      const r = await saveQrWithLayouts(db, owner.id, {
        name,
        model: "static",
        content: { type: "text", text: name },
        layouts: [{ name: "Card", layout: designToLayout(card), editor: designSettingsOf(card) }],
      });
      if (!r.ok) throw new Error("save failed");
      return r.data;
    };
    const a = await make("A");
    const b = await make("B");
    const input = (qrCodeId: string, layoutId: string) => ({
      qrCodeId,
      layoutId,
      layout: designToLayout(sticker),
      editor: designSettingsOf(sticker),
    });
    const before = await rows(a.qrCodeId);

    expect(await updateLayoutDesign(db, other.id, input(a.qrCodeId, a.layoutIds[0] ?? ""), encoded)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await updateLayoutDesign(db, owner.id, input(a.qrCodeId, b.layoutIds[0] ?? ""), encoded)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await updateLayoutDesign(db, owner.id, { ...input(a.qrCodeId, a.layoutIds[0] ?? ""), layout: { preset: "nope" } }, encoded),
    ).toEqual({
      ok: false,
      error: "invalid",
    });
    await softDeleteQrCodes(db, owner.id, [a.qrCodeId]);
    expect(await updateLayoutDesign(db, owner.id, input(a.qrCodeId, a.layoutIds[0] ?? ""), encoded)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await rows(a.qrCodeId)).map((l) => l.design)).toEqual(before.map((l) => l.design));
  });
});

describe.skipIf(!url)("plans, credits and allowances (design 4.8, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "plan-owner", name: "Owner", email: "owner@plan.test" };
  const card = { ...DEFAULT_DESIGN, preset: "caption" as const, caption: "Menu" };
  const make = async (model: "static" | "dynamic" = "static") => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Plan test",
      model,
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      destination: model === "dynamic" ? "https://littlefern.cafe/menu" : undefined,
      layouts: [{ name: "Card", layout: designToLayout(card), editor: designSettingsOf(card) }],
    });
    if (!saved.ok) throw new Error("save failed");
    return saved.data.qrCodeId;
  };
  const purchased = async (id: string) => (await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) }))?.purchasedAt ?? null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("Static Pack credits: granted once per purchase, one credit per static code, never below zero", async () => {
    const [p] = await db
      .insert(schema.purchase)
      .values({
        id: "plan-p3",
        userId: owner.id,
        item: "pack3",
        stripeCheckoutSessionId: "cs_plan_p3",
        amountTotal: 1199,
        currency: "usd",
        status: "paid",
      })
      .returning();
    if (!p) throw new Error("no purchase");
    await grantPackCredits(db, owner.id, p.id, "pack3");
    await grantPackCredits(db, owner.id, p.id, "pack3"); // webhook retry
    expect(await creditBalance(db, owner.id)).toBe(3);
    const a = await make();
    expect(await unlockStatic(db, owner.id, a, "credit")).toEqual({ ok: true, via: "credit" });
    expect(await purchased(a)).not.toBeNull();
    expect(await unlockStatic(db, owner.id, a, "credit")).toEqual({ ok: false, error: "owned" });
    expect(await creditBalance(db, owner.id)).toBe(2);
    const dyn = await make("dynamic");
    expect(await unlockStatic(db, owner.id, dyn, "credit")).toEqual({ ok: false, error: "not_static" });
    // Two at once with two credits left, then one more: exactly two succeed.
    const [b, c, d] = await Promise.all([make(), make(), make()]);
    const results = await Promise.all([b, c, d].map((id) => unlockStatic(db, owner.id, id, "credit")));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "no_credits" }]);
    expect(await creditBalance(db, owner.id)).toBe(0);
  });

  it("a plan's monthly unlocks and included Print Packs: counted per billing period, limited by the plan", async () => {
    const start = new Date("2026-11-01T00:00:00Z");
    await db.insert(schema.subscription).values({
      id: "plan-sub",
      userId: owner.id,
      stripeSubscriptionId: "sub_plan_test",
      stripePriceId: "price_x",
      status: "active",
      plan: "studio",
      activeCodeLimit: 25,
      currentPeriodStart: start,
      currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
    });
    const before = await accountUsage(db, owner.id);
    expect([before.plan?.id, before.unlocks, before.packs, before.dynamic.limit]).toEqual([
      "studio",
      { used: 0, limit: 40 },
      { used: 0, limit: 5 },
      25,
    ]);
    const a = await make();
    expect(await unlockStatic(db, owner.id, a, "plan")).toEqual({ ok: true, via: "plan" });
    expect(await applyPrintPackAllowance(db, owner.id, a)).toEqual({ ok: true });
    expect(await applyPrintPackAllowance(db, owner.id, a)).toEqual({ ok: false, error: "owned" });
    const after = await accountUsage(db, owner.id);
    expect([after.unlocks.used, after.packs.used]).toEqual([1, 1]);
    // The next period starts fresh; the old use stays in its own period.
    await db
      .update(schema.subscription)
      .set({ currentPeriodStart: new Date("2026-12-01T00:00:00Z") })
      .where(eq(schema.subscription.id, "plan-sub"));
    expect((await accountUsage(db, owner.id)).unlocks.used).toBe(0);
    // Starter has no included Print Packs.
    await db.update(schema.subscription).set({ plan: "starter" }).where(eq(schema.subscription.id, "plan-sub"));
    const b = await make();
    expect(await applyPrintPackAllowance(db, owner.id, b)).toEqual({ ok: false, error: "no_allowance" });
    // Without an active plan there are no monthly unlocks.
    await db.update(schema.subscription).set({ status: "canceled" }).where(eq(schema.subscription.id, "plan-sub"));
    expect(await unlockStatic(db, owner.id, b, "plan")).toEqual({ ok: false, error: "no_allowance" });
  });

  it("Dynamic slots: a code goes live while a slot is free; a full plan refuses; an unpaid draft can become static", async () => {
    await db.delete(schema.subscription).where(eq(schema.subscription.userId, owner.id));
    const a = await make("dynamic");
    expect(await activateDynamicCode(db, owner.id, a, () => "slotA01")).toEqual({ ok: false, error: "no_plan" });
    await db.insert(schema.subscription).values({
      id: "plan-sub2",
      userId: owner.id,
      stripeSubscriptionId: "sub_plan_test2",
      stripePriceId: "price_x",
      status: "active",
      plan: "starter",
      activeCodeLimit: 5,
      currentPeriodStart: new Date("2026-11-01T00:00:00Z"),
    });
    expect(await activateDynamicCode(db, owner.id, a, () => "slotA01")).toEqual({ ok: true, shortCode: "slotA01" });
    for (let i = 0; i < 4; i++) {
      const id = await make("dynamic");
      expect((await activateDynamicCode(db, owner.id, id, () => `slotB0${i}`)).ok).toBe(true);
    }
    const sixth = await make("dynamic");
    expect(await activateDynamicCode(db, owner.id, sixth, () => "slotC01")).toEqual({ ok: false, error: "limit" });
    expect(await convertToStatic(db, owner.id, sixth)).toEqual({ ok: true });
    expect(await convertToStatic(db, owner.id, a)).toEqual({ ok: false }); // live codes keep their short link
    expect((await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, sixth) }))?.model).toBe("static");
  });
});

describe.skipIf(!url)("delete one layout (HEY-58, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "dl-owner", name: "Owner", email: "owner@dl.test" };
  const other = { id: "dl-other", name: "Other", email: "other@dl.test" };
  const card = { ...DEFAULT_DESIGN, preset: "caption" as const, caption: "Portfolio" };
  const layout = (name: string) => ({ name, layout: designToLayout(card), editor: designSettingsOf(card) });
  const make = async (userId: string, model: "static" | "dynamic", names: string[]) => {
    const saved = await saveQrWithLayouts(db, userId, {
      name: "Delete test",
      model,
      content: { type: "website", url: "https://anareyes.studio/portfolio" },
      destination: model === "dynamic" ? "https://anareyes.studio/portfolio" : undefined,
      layouts: names.map(layout),
    });
    if (!saved.ok) throw new Error("save failed");
    return saved.data;
  };
  const names = async (qrCodeId: string) =>
    (await db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, qrCodeId), orderBy: (l, { asc }) => asc(l.sortOrder) })).map(
      (l) => l.name,
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("deletes exactly the chosen layout; the code, its payment, Print Pack and sibling layouts stay", async () => {
    const a = await make(owner.id, "static", ["Business card", "Layout 2", "Poster"]);
    const now = new Date();
    await db.update(schema.qrCode).set({ purchasedAt: now, printPackAt: now, status: "active" }).where(eq(schema.qrCode.id, a.qrCodeId));
    const target = a.layoutIds[1] ?? "";
    expect(await removeLayout(db, owner.id, { qrCodeId: a.qrCodeId, layoutId: target })).toEqual({ ok: true, data: { remaining: 2 } });
    expect(await names(a.qrCodeId)).toEqual(["Business card", "Poster"]);
    const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, a.qrCodeId) });
    expect([qr?.purchasedAt?.getTime(), qr?.printPackAt?.getTime(), qr?.status, qr?.deletedAt]).toEqual([
      now.getTime(),
      now.getTime(),
      "active",
      null,
    ]);
    // Already gone: the same request is a not-found, nothing else changes.
    expect(await removeLayout(db, owner.id, { qrCodeId: a.qrCodeId, layoutId: target })).toEqual({ ok: false, error: "not_found" });
    expect(await names(a.qrCodeId)).toEqual(["Business card", "Poster"]);
  });

  it("refuses another account's code and a layout of another code", async () => {
    const a = await make(owner.id, "static", ["Business card", "Layout 2"]);
    const b = await make(owner.id, "static", ["Card", "Poster"]);
    expect(await removeLayout(db, other.id, { qrCodeId: a.qrCodeId, layoutId: a.layoutIds[1] ?? "" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await removeLayout(db, owner.id, { qrCodeId: a.qrCodeId, layoutId: b.layoutIds[1] ?? "" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await names(a.qrCodeId)).toEqual(["Business card", "Layout 2"]);
    expect(await names(b.qrCodeId)).toEqual(["Card", "Poster"]);
  });

  it("keeps at least one layout, also when two deletes run at once", async () => {
    const one = await make(owner.id, "static", ["Only"]);
    expect(await removeLayout(db, owner.id, { qrCodeId: one.qrCodeId, layoutId: one.layoutIds[0] ?? "" })).toEqual({
      ok: false,
      error: "last_layout",
    });
    const two = await make(owner.id, "static", ["First", "Second"]);
    const results = await Promise.all(two.layoutIds.map((layoutId) => removeLayout(db, owner.id, { qrCodeId: two.qrCodeId, layoutId })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "last_layout" }]);
    expect(await names(two.qrCodeId)).toHaveLength(1);
  });

  it("a Dynamic code keeps its short link and destination", async () => {
    const d = await make(owner.id, "dynamic", ["Table tent", "Layout 2"]);
    await db.update(schema.qrCode).set({ shortCode: "dlkeep1", status: "active" }).where(eq(schema.qrCode.id, d.qrCodeId));
    expect((await removeLayout(db, owner.id, { qrCodeId: d.qrCodeId, layoutId: d.layoutIds[1] ?? "" })).ok).toBe(true);
    const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, d.qrCodeId) });
    expect([qr?.shortCode, qr?.destination, qr?.status]).toEqual(["dlkeep1", "https://anareyes.studio/portfolio", "active"]);
    expect(await names(d.qrCodeId)).toEqual(["Table tent"]);
  });
});

/* Design Pricing · Free "Up to 10 saved drafts when signed in" (HEY-60): the limit the page shows is the one enforced. */
describe.skipIf(!url)("draft limit (HEY-60, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "drafts-owner", name: "Owner", email: "owner@drafts.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const save = (text: string, qrCodeId?: string) =>
    saveQrWithLayouts(db, owner.id, { qrCodeId, name: text, model: "static", content: { type: "text", text }, layouts });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("refuses an 11th new draft, also when saves race; editing, unlocking and deleting free the way", async () => {
    // Eight in a row, then four at once: exactly two of the racing saves fit.
    for (let i = 0; i < 8; i++) expect((await save(`d${i}`)).ok).toBe(true);
    const race = await Promise.all([save("r1"), save("r2"), save("r3"), save("r4")]);
    expect(race.filter((r) => r.ok)).toHaveLength(2);
    expect(race.filter((r) => !r.ok && r.error === "draft_limit")).toHaveLength(2);
    expect(await save("eleventh")).toEqual({ ok: false, error: "draft_limit" });

    // Saving an existing draft again is never blocked.
    const first = race.find((r) => r.ok);
    if (!first?.ok) throw new Error("fixture");
    expect((await save("edited", first.data.qrCodeId)).ok).toBe(true);

    // An unlocked code is no longer a draft, so there is room again; so is a deleted one.
    await db.update(schema.qrCode).set({ status: "active", purchasedAt: new Date() }).where(eq(schema.qrCode.id, first.data.qrCodeId));
    expect((await save("after unlock")).ok).toBe(true);
    expect(await save("full again")).toEqual({ ok: false, error: "draft_limit" });
    const anyDraft = await db.query.qrCode.findFirst({ where: (q, { and, eq }) => and(eq(q.userId, owner.id), eq(q.status, "draft")) });
    if (!anyDraft) throw new Error("fixture");
    await softDeleteQrCodes(db, owner.id, [anyDraft.id]);
    expect((await save("after delete")).ok).toBe(true);
  });

  it("with exactly one slot left, two new drafts at once: one is saved, one gets the limit (HEY-80)", async () => {
    const other = { id: "drafts-one-slot", name: "One slot", email: "one-slot@drafts.test" };
    await db.insert(schema.user).values(other).onConflictDoNothing();
    try {
      const saveAs = (text: string, claimKey?: string) =>
        saveQrWithLayouts(db, other.id, { name: text, model: "static", content: { type: "text", text }, layouts, claimKey });
      for (let i = 0; i < DRAFT_LIMIT - 1; i++) expect((await saveAs(`s${i}`)).ok).toBe(true);
      const [a, b] = await Promise.all([saveAs("tab A"), saveAs("tab B")]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok && r.error === "draft_limit")).toHaveLength(1);
      const count = async () =>
        Number(
          (
            await pool.query(`select count(*)::int as n from qr_code where user_id = $1 and status = 'draft' and deleted_at is null`, [
              other.id,
            ])
          ).rows[0].n,
        );
      expect(await count()).toBe(DRAFT_LIMIT);
      // A guest draft attached after sign-in (HEY-77) counts too, and is saved once a slot is freed.
      expect(await saveAs("guest draft", "hey80claimkey00000001")).toEqual({ ok: false, error: "draft_limit" });
      const oldest = await db.query.qrCode.findFirst({ where: (q, { and, eq }) => and(eq(q.userId, other.id), eq(q.name, "s0")) });
      if (!oldest) throw new Error("fixture");
      await softDeleteQrCodes(db, other.id, [oldest.id]);
      expect((await saveAs("guest draft", "hey80claimkey00000001")).ok).toBe(true);
      expect(await count()).toBe(DRAFT_LIMIT);
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, other.id));
    }
  });

  it("rename changes only the owner's code name: content, short link, layouts and purchase stay (HEY-80)", async () => {
    // Its own owner: the draft-limit test above leaves "owner" at the limit.
    const renamer = { id: "drafts-renamer", name: "Renamer", email: "renamer@drafts.test" };
    const stranger = { id: "drafts-stranger", name: "Stranger", email: "stranger@drafts.test" };
    await db.insert(schema.user).values([renamer, stranger]).onConflictDoNothing();
    try {
      const saved = await saveQrWithLayouts(db, renamer.id, {
        name: "Before",
        model: "dynamic",
        content: { type: "website", url: "https://littlefern.cafe/hey80" },
        destination: "https://littlefern.cafe/hey80",
        layouts: [{ name: "Poster", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }],
      });
      if (!saved.ok) throw new Error("fixture");
      const id = saved.data.qrCodeId;
      await db
        .update(schema.qrCode)
        .set({ status: "active", shortCode: "hey80lnk", purchasedAt: new Date() })
        .where(eq(schema.qrCode.id, id));
      const snapshot = async () =>
        (
          await pool.query(
            `select q.name, q.content, q.short_code, q.destination, q.status, q.purchased_at is not null as bought,
               (select string_agg(l.name || ':' || md5(l.design::text), ',' order by l.sort_order) from qr_layout l where l.qr_code_id = q.id) as layouts
             from qr_code q where q.id = $1`,
            [id],
          )
        ).rows[0];
      const before = await snapshot();
      expect(await renameQrCode(db, stranger.id, id, "Hijacked")).toEqual({ ok: false, error: "not_found" });
      expect(await renameQrCode(db, renamer.id, id, "   ")).toEqual({ ok: false, error: "invalid" });
      expect(await renameQrCode(db, renamer.id, id, "  After  ")).toEqual({ ok: true });
      expect(await snapshot()).toEqual({ ...before, name: "After" });
    } finally {
      await db.delete(schema.user).where(inArray(schema.user.id, [renamer.id, stranger.id]));
    }
  });
});

/* HEY-82 QR details "New layout": a copy of a saved layout under the same code, independent from its source. */
describe.skipIf(!url)("copy a saved layout (HEY-82, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey82-owner", name: "Owner", email: "owner@hey82.test" };
  const other = { id: "hey82-other", name: "Other", email: "other@hey82.test" };
  const card = {
    ...DEFAULT_DESIGN,
    preset: "horizontal" as const,
    caption: "Call 555 0101",
    logo: { kind: "icon" as const, icon: "coffee" as const },
  };
  let n = 0;
  const id = () => `hey82-l${++n}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("copies the source's design under a new id; editing the copy (logo removed) leaves the source and the code as they were", async () => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Shop",
      model: "static",
      content: { type: "website", url: "https://shop.example/hey82" },
      layouts: [{ name: "Business card", layout: designToLayout(card), editor: designSettingsOf(card) }],
    });
    if (!saved.ok) throw new Error("fixture");
    const qrCodeId = saved.data.qrCodeId;
    const sourceId = saved.data.layoutIds[0] ?? "";
    await db.update(schema.qrCode).set({ status: "active", purchasedAt: new Date() }).where(eq(schema.qrCode.id, qrCodeId));
    const row = async (layoutId: string) => (await pool.query(`select name, design from qr_layout where id = $1`, [layoutId])).rows[0];
    const code = async () =>
      (await pool.query(`select name, content, status, purchased_at is not null as bought from qr_code where id = $1`, [qrCodeId])).rows[0];
    const sourceBefore = await row(sourceId);
    const codeBefore = await code();
    const drafts = async () =>
      Number((await pool.query(`select count(*)::int as n from qr_code where user_id = $1 and status = 'draft'`, [owner.id])).rows[0].n);
    const draftsBefore = await drafts();

    const copy = await copyLayout(db, owner.id, { qrCodeId, sourceLayoutId: sourceId, name: "Layout 2" }, id);
    expect(copy).toEqual({ ok: true, data: { layoutId: "hey82-l1" } });
    expect(await row("hey82-l1")).toEqual({ name: "Layout 2", design: sourceBefore.design });

    // Edit only the copy: another caption, a poster size and no logo.
    const poster = { ...card, preset: "vertical" as const, caption: "Spring poster", logo: { kind: "none" as const } };
    const edited = await updateLayoutDesign(
      db,
      owner.id,
      { qrCodeId, layoutId: "hey82-l1", layout: designToLayout(poster), editor: designSettingsOf(poster), name: "Poster" },
      () => "https://shop.example/hey82",
    );
    expect(edited.ok).toBe(true);
    expect(await row(sourceId)).toEqual(sourceBefore);
    expect((await row("hey82-l1")).design.editor).toMatchObject({ caption: "Spring poster", preset: "vertical", logo: { kind: "none" } });
    expect(await code()).toEqual(codeBefore);
    expect(await drafts()).toBe(draftsBefore);
  });

  it("refuses another account's code and a source layout of a different code", async () => {
    const mine = await saveQrWithLayouts(db, owner.id, {
      name: "Mine",
      model: "static",
      content: { type: "text", text: "hey82 mine" },
      layouts: [{ name: "Card", layout: designToLayout(card), editor: designSettingsOf(card) }],
    });
    const theirs = await saveQrWithLayouts(db, other.id, {
      name: "Theirs",
      model: "static",
      content: { type: "text", text: "hey82 theirs" },
      layouts: [{ name: "Card", layout: designToLayout(card), editor: designSettingsOf(card) }],
    });
    if (!mine.ok || !theirs.ok) throw new Error("fixture");
    const mineLayout = mine.data.layoutIds[0] ?? "";
    const theirLayout = theirs.data.layoutIds[0] ?? "";
    expect(await copyLayout(db, other.id, { qrCodeId: mine.data.qrCodeId, sourceLayoutId: mineLayout, name: "Stolen" }, id)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await copyLayout(db, owner.id, { qrCodeId: mine.data.qrCodeId, sourceLayoutId: theirLayout, name: "Mixed" }, id)).toEqual({
      ok: false,
      error: "not_found",
    });
    const { rows } = await pool.query(`select count(*)::int as n from qr_layout where qr_code_id in ($1, $2)`, [
      mine.data.qrCodeId,
      theirs.data.qrCodeId,
    ]);
    expect(rows[0].n).toBe(2);
  });
});

/* HEY-83: uploaded logos in private storage, referenced by saved layouts and resolved for their owner only. */
describe.skipIf(!url)("private logo storage (HEY-83, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const a = { id: "hey83-a", name: "A", email: "a@hey83.test" };
  const b = { id: "hey83-b", name: "B", email: "b@hey83.test" };
  const objects = new Map<string, Uint8Array>();
  const store: LogoStore = {
    put: async (key, body) => void objects.set(key, body),
    get: async (key) => objects.get(key) ?? null,
    remove: async (key) => void objects.delete(key),
  };
  let n = 0;
  const id = () => `hey83asset${String(++n).padStart(4, "0")}`;
  // 1×1 PNG and a small SVG: two different uploaded logos.
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#8C2F4B"/></svg>').toString("base64")}`;
  const withLogo = (href: string, caption = "Logo card") => {
    const d = { ...DEFAULT_DESIGN, preset: "horizontal" as const, caption, logo: { kind: "image" as const, href } };
    return { layout: designToLayout(d), editor: designSettingsOf(d) };
  };
  const prepareFor =
    (userId: string): PrepareRecord =>
    (tx, rec) =>
      storeLogos(tx, store, userId, rec, id);
  const stored = async (layoutId: string) => (await pool.query(`select design from qr_layout where id = $1`, [layoutId])).rows[0].design;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([a, b]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.qrCode).where(inArray(schema.qrCode.userId, [a.id, b.id]));
    await db?.delete(schema.asset).where(inArray(schema.asset.userId, [a.id, b.id]));
    await db?.delete(schema.user).where(inArray(schema.user.id, [a.id, b.id]));
    await pool?.end();
  });

  it("stores an uploaded logo privately once, references it by id, and resolves it for the owner", async () => {
    const saved = await saveQrWithLayouts(
      db,
      a.id,
      {
        name: "Logo code",
        model: "static",
        content: { type: "text", text: "hey83" },
        layouts: [
          { name: "Card", ...withLogo(PNG) },
          { name: "Poster", ...withLogo(PNG, "Poster") },
        ],
      },
      prepareFor(a.id),
    );
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const [first, second] = saved.data.layoutIds;
    const design = await stored(first ?? "");
    expect(JSON.stringify(design)).not.toContain("data:image");
    const [assetId] = referencedAssets(design);
    expect(design.layout.style.logo.href).toBe(`asset:${assetId}`);
    expect(design.editor.logo).toEqual({ kind: "image", href: `asset:${assetId}` });
    // Both variants share the one file.
    expect(referencedAssets(await stored(second ?? ""))).toEqual([assetId]);
    const rows = (await pool.query(`select id, storage_key, content_type, byte_size from asset where user_id = $1`, [a.id])).rows;
    expect(rows).toEqual([{ id: assetId, storage_key: `logos/${a.id}/${assetId}.png`, content_type: "image/png", byte_size: 70 }]);
    expect(objects.has(`logos/${a.id}/${assetId}.png`)).toBe(true);
    const [resolved] = await resolveLogos(db, store, a.id, [design]);
    expect(resolved.layout.style.logo.href).toBe(PNG);
    expect(resolved.editor.logo).toEqual({ kind: "image", href: PNG });
  });

  it("replacing the logo on a copy stores a new file and leaves the source's logo as it was", async () => {
    const [code] = (await pool.query(`select id from qr_code where user_id = $1 and name = 'Logo code'`, [a.id])).rows;
    const [src] = (await pool.query(`select id from qr_layout where qr_code_id = $1 order by sort_order limit 1`, [code.id])).rows;
    const copy = await copyLayout(db, a.id, { qrCodeId: code.id, sourceLayoutId: src.id, name: "Copy" }, () => "hey83-copy");
    expect(copy.ok).toBe(true);
    const before = await stored(src.id);
    const edited = await updateLayoutDesign(
      db,
      a.id,
      { qrCodeId: code.id, layoutId: "hey83-copy", ...withLogo(SVG, "Copy") },
      () => "hey83",
      prepareFor(a.id),
    );
    expect(edited.ok).toBe(true);
    expect(await stored(src.id)).toEqual(before);
    const [srcAsset] = referencedAssets(before);
    const [copyAsset] = referencedAssets(await stored("hey83-copy"));
    expect(copyAsset).not.toBe(srcAsset);
    const [resolvedSource] = await resolveLogos(db, store, a.id, [before]);
    expect(resolvedSource.layout.style.logo.href).toBe(PNG);
  });

  it("another account can't use or read the file: its reference is refused on save and dropped on read", async () => {
    const [{ id: assetId }] = (await pool.query(`select id from asset where user_id = $1 order by created_at limit 1`, [a.id])).rows;
    const stolen = await saveQrWithLayouts(
      db,
      b.id,
      {
        name: "Theirs",
        model: "static",
        content: { type: "text", text: "hey83 b" },
        layouts: [{ name: "Card", ...withLogo(`asset:${assetId}`) }],
      },
      prepareFor(b.id),
    );
    expect(stolen).toEqual({ ok: false, error: "invalid" });
    const design = await stored(
      (await pool.query(`select l.id from qr_layout l join qr_code q on q.id = l.qr_code_id where q.user_id = $1 limit 1`, [a.id])).rows[0]
        .id,
    );
    const [asB] = await resolveLogos(db, store, b.id, [design]);
    expect(asB.layout.style.logo?.href).toBeUndefined();
    expect(asB.editor.logo).toEqual({ kind: "none" });
  });

  it("refuses an unsupported or oversized upload, and a logo URL", async () => {
    const save = (href: string) =>
      saveQrWithLayouts(
        db,
        b.id,
        { name: "Bad", model: "static", content: { type: "text", text: "bad" }, layouts: [{ name: "Card", ...withLogo(href) }] },
        prepareFor(b.id),
      );
    expect(await save("data:image/gif;base64,R0lGODlhAQABAAAAACw=")).toEqual({ ok: false, error: "invalid" });
    expect(await save(`data:image/png;base64,${"A".repeat(14_000_000)}`)).toEqual({ ok: false, error: "invalid" });
    expect(await save("https://cdn.example/logo.png")).toEqual({ ok: false, error: "invalid" });
    // A PNG that is really an SVG (declared type doesn't match the bytes).
    expect(await save(`data:image/png;base64,${SVG.split(",")[1]}`)).toEqual({ ok: false, error: "invalid" });
  });

  it("cleanup removes only expired files no layout refers to, keeps restorable ones, and skips a file a save holds", async () => {
    const aged = async (assetId: string) =>
      pool.query(`update asset set last_used_at = now() - interval '2 days' where id = $1`, [assetId]);
    // An abandoned upload: stored by a save that was then refused.
    const abandonedKey = `logos/${a.id}/hey83orphan.png`;
    await store.put(abandonedKey, new Uint8Array([1]), "image/png");
    await pool.query(
      `insert into asset (id, user_id, storage_key, content_type, byte_size, sha256) values ('hey83orphan', $1, $2, 'image/png', 1, 'orphan')`,
      [a.id, abandonedKey],
    );
    await aged("hey83orphan");
    // A recent unreferenced upload stays (it may be about to be saved).
    await pool.query(
      `insert into asset (id, user_id, storage_key, content_type, byte_size, sha256) values ('hey83recent', $1, 'logos/x/recent.png', 'image/png', 1, 'recent')`,
      [a.id],
    );
    // Files referenced by active layouts and by a soft-deleted (restorable) code are aged too.
    for (const { id: assetId } of (
      await pool.query(`select id from asset where user_id = $1 and sha256 not in ('orphan', 'recent')`, [a.id])
    ).rows)
      await aged(assetId);
    const [{ id: codeId }] = (await pool.query(`select id from qr_code where user_id = $1 and name = 'Logo code'`, [a.id])).rows;
    await softDeleteQrCodes(db, a.id, [codeId]);
    // A save holding the orphan's row (as storeLogos does) makes cleanup skip it this time.
    const held = await pool.connect();
    await held.query("begin");
    await held.query(`select id from asset where id = 'hey83orphan' for update`);
    expect(await cleanupLogos(db, store)).toEqual([]);
    await held.query("rollback");
    held.release();
    expect(await cleanupLogos(db, store)).toEqual([abandonedKey]);
    expect(objects.has(abandonedKey)).toBe(false);
    const left = (await pool.query(`select id from asset where user_id = $1 order by id`, [a.id])).rows.map((r) => r.id);
    expect(left).toContain("hey83recent");
    expect(left).not.toContain("hey83orphan");
    expect(left.length).toBe(3);
    // The restorable code still renders its logo.
    const design = await stored(
      (await pool.query(`select id from qr_layout where qr_code_id = $1 order by sort_order limit 1`, [codeId])).rows[0].id,
    );
    expect((await resolveLogos(db, store, a.id, [design]))[0].layout.style.logo.href).toBe(PNG);
  });
});

/* HEY-84: every read and write of a code, its layouts and their files is the session user's own, as one chain. */
describe.skipIf(!url)("authorization of codes, layouts and files (HEY-84, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const a = { id: "hey84-a", name: "A", email: "a@hey84.test" };
  const b = { id: "hey84-b", name: "B", email: "b@hey84.test" };
  const puts: string[] = [];
  const objects = new Map<string, Uint8Array>();
  const store: LogoStore = {
    put: async (key, body) => void (puts.push(key), objects.set(key, body)),
    get: async (key) => objects.get(key) ?? null,
    remove: async (key) => void objects.delete(key),
  };
  let n = 0;
  const id = () => `hey84id${String(++n).padStart(6, "0")}`;
  const prep =
    (userId: string): PrepareRecord =>
    (tx, rec) =>
      storeLogos(tx, store, userId, rec, id);
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>').toString("base64")}`;
  const design = (href?: string, caption = "Card") => {
    const d = { ...DEFAULT_DESIGN, caption, logo: href ? { kind: "image" as const, href } : { kind: "none" as const } };
    return { layout: designToLayout(d), editor: designSettingsOf(d) };
  };
  const ids = { aQr: "", aL1: "", aL2: "", aQr2: "", aQr2L: "", bQr: "", bL: "", aAsset: "", bAsset: "" };
  const snapshot = async () =>
    JSON.stringify(
      (
        await pool.query(
          `select q.id, q.user_id, q.name, q.deleted_at is null as live, l.id as l, l.name as ln, md5(l.design::text) as d
           from qr_code q left join qr_layout l on l.qr_code_id = q.id where q.user_id in ($1, $2) order by q.id, l.id`,
          [a.id, b.id],
        )
      ).rows,
    ) +
    JSON.stringify(
      (await pool.query(`select id, user_id, storage_key from asset where user_id in ($1, $2) order by id`, [a.id, b.id])).rows,
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([a, b]).onConflictDoNothing();
    const save = async (userId: string, name: string, layouts: { name: string; layout: unknown; editor: unknown }[]) => {
      const r = await saveQrWithLayouts(
        db,
        userId,
        { name, model: "static", content: { type: "text", text: name }, layouts },
        prep(userId),
      );
      if (!r.ok) throw new Error(JSON.stringify(r));
      return r.data;
    };
    const aSaved = await save(a.id, "A code", [
      { name: "Business card", ...design(PNG) },
      { name: "Poster", ...design(undefined, "Poster") },
    ]);
    [ids.aQr, ids.aL1, ids.aL2] = [aSaved.qrCodeId, aSaved.layoutIds[0] ?? "", aSaved.layoutIds[1] ?? ""];
    const aOther = await save(a.id, "A second code", [{ name: "Sticker", ...design() }]);
    [ids.aQr2, ids.aQr2L] = [aOther.qrCodeId, aOther.layoutIds[0] ?? ""];
    const bSaved = await save(b.id, "B code", [{ name: "Menu", ...design(SVG) }]);
    [ids.bQr, ids.bL] = [bSaved.qrCodeId, bSaved.layoutIds[0] ?? ""];
    ids.aAsset =
      referencedAssets(await (await pool.query(`select design from qr_layout where id = $1`, [ids.aL1])).rows[0].design)[0] ?? "";
    ids.bAsset = referencedAssets(await (await pool.query(`select design from qr_layout where id = $1`, [ids.bL])).rows[0].design)[0] ?? "";
  });
  afterAll(async () => {
    await db?.delete(schema.qrCode).where(inArray(schema.qrCode.userId, [a.id, b.id]));
    await db?.delete(schema.asset).where(inArray(schema.asset.userId, [a.id, b.id]));
    await db?.delete(schema.user).where(inArray(schema.user.id, [a.id, b.id]));
    await pool?.end();
  });

  it("reads: only the owner, and only a layout of that code and a file that layout uses", async () => {
    expect((await ownedLayout(db, a.id, ids.aQr, ids.aL1))?.layout.name).toBe("Business card");
    expect(await ownedLayout(db, b.id, ids.aQr, ids.aL1)).toBeNull(); // another account
    expect(await ownedLayout(db, a.id, ids.aQr, ids.bL)).toBeNull(); // B's layout under A's code
    expect(await ownedLayout(db, a.id, ids.aQr, ids.aQr2L)).toBeNull(); // A's layout of a different code
    expect(await authorizedLogo(db, a.id, { qrCodeId: ids.aQr, layoutId: ids.aL1, assetId: ids.aAsset })).toMatchObject({
      key: `logos/${a.id}/${ids.aAsset}.png`,
    });
    for (const [user, qrCodeId, layoutId, assetId] of [
      [b.id, ids.aQr, ids.aL1, ids.aAsset], // another account asks for A's file
      [a.id, ids.aQr, ids.aL2, ids.aAsset], // a layout of the code that doesn't use that file
      [a.id, ids.aQr, ids.aL1, ids.bAsset], // B's file named on A's layout
      [a.id, ids.aQr2, ids.aL1, ids.aAsset], // code and layout don't belong together
      [b.id, ids.bQr, ids.bL, ids.aAsset], // B's own layout, A's file
    ] as const)
      expect(await authorizedLogo(db, user, { qrCodeId, layoutId, assetId })).toBeNull();
    await softDeleteQrCodes(db, a.id, [ids.aQr2]);
    expect(await ownedLayout(db, a.id, ids.aQr2, ids.aQr2L)).toBeNull(); // a deleted code
  });

  it("a save stores an uploaded logo once, though the layout keeps it in two places", async () => {
    puts.length = 0;
    const r = await saveQrWithLayouts(
      db,
      b.id,
      { name: "One upload", model: "static", content: { type: "text", text: "once" }, layouts: [{ name: "Card", ...design(PNG) }] },
      prep(b.id),
    );
    expect(r.ok).toBe(true);
    expect(puts).toHaveLength(1);
  });

  it("denied writes change neither the database nor storage", async () => {
    const before = await snapshot();
    puts.length = 0;
    const encoded = () => "x";
    const refused = [
      await updateLayoutDesign(db, b.id, { qrCodeId: ids.aQr, layoutId: ids.aL1, ...design(SVG, "Hijack") }, encoded, prep(b.id)),
      await updateLayoutDesign(db, a.id, { qrCodeId: ids.aQr, layoutId: ids.bL, ...design(SVG, "Mixed") }, encoded, prep(a.id)),
      await addLayoutFrom(db, b.id, { qrCodeId: ids.aQr, name: "Extra", ...design(SVG) }, encoded, id, prep(b.id)),
      await copyLayout(db, b.id, { qrCodeId: ids.aQr, sourceLayoutId: ids.aL1, name: "Copy" }, id),
      await copyLayout(db, a.id, { qrCodeId: ids.aQr, sourceLayoutId: ids.bL, name: "Copy" }, id),
      await removeLayout(db, b.id, { qrCodeId: ids.aQr, layoutId: ids.aL2 }),
      await renameQrCode(db, b.id, ids.aQr, "Hijacked"),
      await saveQrWithLayouts(
        db,
        b.id,
        {
          qrCodeId: ids.aQr,
          name: "Hijacked",
          model: "static",
          content: { type: "text", text: "x" },
          layouts: [{ name: "X", ...design(SVG) }],
        },
        prep(b.id),
      ),
    ];
    for (const r of refused) expect(r).toMatchObject({ ok: false, error: "not_found" });
    expect(await softDeleteQrCodes(db, b.id, [ids.aQr])).toEqual([]);
    expect(puts).toEqual([]);
    expect(await snapshot()).toBe(before);
  });
});

/* HEY-85: two tabs saving the same layout from the same version: one wins, the other is a conflict, nothing is lost. */
describe.skipIf(!url)("concurrent layout saves (HEY-85, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey85-owner", name: "Owner", email: "owner@hey85.test" };
  const puts: string[] = [];
  const store: LogoStore = { put: async (key) => void puts.push(key), get: async () => null, remove: async () => undefined };
  let n = 0;
  const id = () => `hey85id${String(++n).padStart(6, "0")}`;
  const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>').toString("base64")}`;
  const design = (caption: string, logo?: string) => {
    const d = { ...DEFAULT_DESIGN, caption, logo: logo ? { kind: "image" as const, href: logo } : { kind: "none" as const } };
    return { layout: designToLayout(d), editor: designSettingsOf(d) };
  };
  const revisionOf = async (layoutId: string) =>
    (await db.select({ r: layoutRevision }).from(schema.qrLayout).where(eq(schema.qrLayout.id, layoutId)))[0]?.r ?? "";
  const captionOf = async (layoutId: string) =>
    (await pool.query(`select design->'editor'->>'caption' as c from qr_layout where id = $1`, [layoutId])).rows[0].c;
  let qrCodeId = "";
  let l1 = "";
  let l2 = "";

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Two tabs",
      model: "static",
      content: { type: "text", text: "two tabs" },
      layouts: [
        { name: "Card", ...design("Original") },
        { name: "Poster", ...design("Poster original") },
      ],
    });
    if (!saved.ok) throw new Error("fixture");
    qrCodeId = saved.data.qrCodeId;
    [l1, l2] = [saved.data.layoutIds[0] ?? "", saved.data.layoutIds[1] ?? ""];
  });
  afterAll(async () => {
    await db?.delete(schema.qrCode).where(eq(schema.qrCode.userId, owner.id));
    await db?.delete(schema.asset).where(eq(schema.asset.userId, owner.id));
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  const save = (layoutId: string, caption: string, revision?: string, logo?: string) =>
    updateLayoutDesign(
      db,
      owner.id,
      { qrCodeId, layoutId, revision, ...design(caption, logo) },
      () => "two tabs",
      (tx, rec) => storeLogos(tx, store, owner.id, rec, id),
    );

  it("both tabs save from the same version at once: exactly one wins, the other is a conflict and stores nothing", async () => {
    const opened = await revisionOf(l1);
    puts.length = 0;
    const [tabA, tabB] = await Promise.all([save(l1, "Tab A", opened), save(l1, "Tab B", opened, SVG)]);
    const winners = [tabA, tabB].filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect([tabA, tabB].filter((r) => !r.ok)).toEqual([{ ok: false, error: "conflict" }]);
    const aWon = tabA.ok;
    expect(await captionOf(l1)).toBe(aWon ? "Tab A" : "Tab B");
    const won = aWon ? tabA : tabB;
    expect(won.ok && won.data.revision).toBe(await revisionOf(l1));
    // Tab B carried a new logo: stored only if B won.
    expect(puts.length).toBe(aWon ? 0 : 1);
  });

  it("a save from an older version is a conflict; the newer save stays", async () => {
    const opened = await revisionOf(l1);
    expect((await save(l1, "Newer", opened)).ok).toBe(true);
    expect(await save(l1, "Stale", opened)).toEqual({ ok: false, error: "conflict" });
    expect(await captionOf(l1)).toBe("Newer");
  });

  it("two different layouts of the code saved at once both succeed", async () => {
    const [r1, r2] = await Promise.all([save(l1, "Card again", await revisionOf(l1)), save(l2, "Poster again", await revisionOf(l2))]);
    expect(r1.ok && r2.ok).toBe(true);
    expect([await captionOf(l1), await captionOf(l2)]).toEqual(["Card again", "Poster again"]);
  });
});

/* HEY-87: each grant source unlocks one static code once; repeat downloads and repeated deliveries never grant or charge again. */
describe.skipIf(!url)("repeat-download entitlements (HEY-87, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey87-owner", name: "Owner", email: "owner@hey87.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const code = async (text: string) => {
    const r = await saveQrWithLayouts(db, owner.id, { name: text, model: "static", content: { type: "text", text }, layouts });
    if (!r.ok) throw new Error("fixture");
    return r.data.qrCodeId;
  };
  const qrRow = async (id: string) =>
    (await pool.query(`select purchased_at, print_pack_at, status from qr_code where id = $1`, [id])).rows[0] as {
      purchased_at: Date | null;
      print_pack_at: Date | null;
      status: string;
    };
  const order = async (id: string, qrCodeId: string | null, item = "single_qr") =>
    pool.query(
      `insert into purchase (id, user_id, qr_code_id, item, stripe_checkout_session_id, amount_total, currency, status) values ($1, $2, $3, $4, $5, 499, 'usd', 'pending')`,
      [id, owner.id, qrCodeId, item, `cs_test_${id}`],
    );
  const session = (id: string, metadata: Record<string, string>, payment_status: "paid" | "unpaid" = "paid") => ({
    id: `cs_test_${id}`,
    mode: "payment" as const,
    status: payment_status === "paid" ? ("complete" as const) : ("open" as const),
    payment_status,
    payment_intent: `pi_${id}`,
    amount_subtotal: 499,
    amount_total: 499,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    currency: "usd",
    metadata: { userId: owner.id, ...metadata },
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.purchase).where(eq(schema.purchase.userId, owner.id));
    await db?.delete(schema.creditLedger).where(eq(schema.creditLedger.userId, owner.id));
    await db?.delete(schema.allowanceUse).where(eq(schema.allowanceUse.userId, owner.id));
    await db?.delete(schema.subscription).where(eq(schema.subscription.userId, owner.id));
    await db?.delete(schema.qrCode).where(eq(schema.qrCode.userId, owner.id));
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("a paid Single QR order unlocks its own code exactly once; redelivery and the async event change nothing", async () => {
    const qr = await code("single");
    const other = await code("single"); // same content, its own code
    await order("o1", qr);
    const receipts: string[] = [];
    const deliver = async (metadata: Record<string, string>) => {
      const r = await fulfillCheckout(db, session("o1", metadata), () => "s");
      if (r.granted && r.receipt) receipts.push(r.receipt.qrCodeId);
      return r;
    };
    expect(await deliver({ qrCodeId: qr, layoutId: "x", kind: "code" })).toMatchObject({ granted: true });
    const first = await qrRow(qr);
    expect(first.purchased_at).not.toBeNull();
    expect(first.status).toBe("active");
    // Stripe redelivers, and sends async_payment_succeeded for the same session.
    expect(await deliver({ qrCodeId: qr, kind: "code" })).toMatchObject({ granted: false });
    expect(await deliver({ qrCodeId: qr, kind: "code" })).toMatchObject({ granted: false });
    expect((await qrRow(qr)).purchased_at).toEqual(first.purchased_at);
    expect(receipts).toEqual([qr]);
    expect((await pool.query(`select count(*)::int as n from purchase where user_id = $1 and status = 'paid'`, [owner.id])).rows[0].n).toBe(
      1,
    );
    // The same content in another code stays locked.
    expect((await qrRow(other)).purchased_at).toBeNull();
  });

  it("an unpaid session, or an order of another code, grants nothing", async () => {
    const qr = await code("unpaid");
    await order("o2", qr);
    expect(await fulfillCheckout(db, session("o2", { qrCodeId: qr, kind: "code" }, "unpaid"), () => "s")).toMatchObject({ granted: false });
    expect((await qrRow(qr)).purchased_at).toBeNull();
    // Metadata naming a different code than the order's own: no unlock of either.
    const other = await code("other");
    expect(await fulfillCheckout(db, session("o2", { qrCodeId: other, kind: "code" }), () => "s")).toMatchObject({ granted: false });
    expect((await qrRow(qr)).purchased_at).toBeNull();
    expect((await qrRow(other)).purchased_at).toBeNull();
  });

  it("a pack's credits and a Print Pack are granted once per order; the Print Pack stays a separate grant", async () => {
    await order("o3", null, "pack3");
    const pack = session("o3", { kind: "pack", pack: "pack3" });
    expect((await fulfillCheckout(db, pack, () => "s")).granted).toBe(true);
    expect((await fulfillCheckout(db, pack, () => "s")).granted).toBe(false);
    expect(await creditBalance(db, owner.id)).toBe(3);
    const qr = await code("print");
    await db.update(schema.qrCode).set({ purchasedAt: new Date(), status: "active" }).where(eq(schema.qrCode.id, qr));
    expect((await qrRow(qr)).print_pack_at).toBeNull(); // unlocked, no Print Pack yet
    await order("o4", qr, "print_pack");
    const pp = session("o4", { qrCodeId: qr, kind: "print_pack" });
    expect((await fulfillCheckout(db, pp, () => "s")).granted).toBe(true);
    const at = (await qrRow(qr)).print_pack_at;
    expect(at).not.toBeNull();
    expect((await fulfillCheckout(db, pp, () => "s")).granted).toBe(false);
    expect((await qrRow(qr)).print_pack_at).toEqual(at);
  });

  it("a credit or a monthly unlock grants the same unlock once; asking again uses nothing; it outlives the plan", async () => {
    const byCredit = await code("credit");
    const balance = await creditBalance(db, owner.id);
    expect(await unlockStatic(db, owner.id, byCredit, "credit")).toEqual({ ok: true, via: "credit" });
    expect(await unlockStatic(db, owner.id, byCredit, "credit")).toEqual({ ok: false, error: "owned" });
    expect(await creditBalance(db, owner.id)).toBe(balance - 1);

    await db.insert(schema.subscription).values({
      id: "hey87-sub",
      userId: owner.id,
      stripeSubscriptionId: "sub_hey87",
      stripePriceId: "price_starter",
      plan: "starter",
      status: "active",
      activeCodeLimit: 5,
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000),
    });
    const byPlan = await code("plan");
    expect(await unlockStatic(db, owner.id, byPlan, "plan")).toEqual({ ok: true, via: "plan" });
    const usedAfter = (await accountUsage(db, owner.id)).unlocks.used;
    expect(await unlockStatic(db, owner.id, byPlan, "plan")).toEqual({ ok: false, error: "owned" });
    expect((await accountUsage(db, owner.id)).unlocks.used).toBe(usedAfter);
    // The plan ends: what it unlocked stays unlocked; a new code now needs a new unlock.
    await db.update(schema.subscription).set({ status: "canceled" }).where(eq(schema.subscription.id, "hey87-sub"));
    expect((await qrRow(byPlan)).purchased_at).not.toBeNull();
    const after = await code("after the plan");
    expect(await unlockStatic(db, owner.id, after, "plan")).toEqual({ ok: false, error: "no_allowance" });
  });
});

/* HEY-88: a Single QR order is the account's and the code's before Stripe is called, and the stored order decides fulfilment. */
describe.skipIf(!url)("Single QR order binding (HEY-88, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey88-owner", name: "Owner", email: "owner@hey88.test" };
  const other = { id: "hey88-other", name: "Other", email: "other@hey88.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const charge = { item: "single_qr" as const, lines: [{ offer: "single" as const, amount: 499 }], currency: "USD" };

  /** Stripe stand-in: every session it made, with its state; `failNext` makes the next create throw. */
  const stripe = () => {
    const sessions = new Map<string, { orderId: string; status: "open" | "complete" | "expired" }>();
    let n = 0;
    const state = { failNext: false, creates: 0 };
    const port: CheckoutPort = {
      create: async ({ orderId }) => {
        state.creates++;
        if (state.failNext) {
          state.failNext = false;
          throw new Error("Stripe unavailable");
        }
        const id = `cs_test_hey88_${++n}_${Math.random().toString(36).slice(2, 8)}`;
        sessions.set(id, { orderId, status: "open" });
        return { id, url: `https://checkout.stripe.test/${id}`, amount_total: 499, currency: "usd" };
      },
      retrieve: async (id) => ({ status: sessions.get(id)?.status ?? null, url: `https://checkout.stripe.test/${id}` }),
      expire: async (id) => {
        const s = sessions.get(id);
        if (!s || s.status !== "open") throw new Error("not open");
        s.status = "expired";
      },
    };
    return { port, sessions, state };
  };
  const code = async (userId: string, text: string) => {
    const r = await saveQrWithLayouts(db, userId, { name: text, model: "static", content: { type: "text", text }, layouts });
    if (!r.ok) throw new Error("fixture");
    const layout = await db.query.qrLayout.findFirst({ where: eq(schema.qrLayout.qrCodeId, r.data.qrCodeId) });
    return { qrCodeId: r.data.qrCodeId, layoutId: layout?.id ?? "" };
  };
  const ordersOf = async (qrCodeId: string) => db.query.purchase.findMany({ where: eq(schema.purchase.qrCodeId, qrCodeId) });
  const unlocked = async (qrCodeId: string) =>
    (await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, qrCodeId) }))?.purchasedAt !== null;
  const paidEvent = (sessionId: string, metadata: Record<string, string>, payment_status: "paid" | "unpaid" = "paid") => ({
    id: sessionId,
    mode: "payment" as const,
    status: payment_status === "paid" ? ("complete" as const) : ("open" as const),
    payment_status,
    payment_intent: `pi_${sessionId}`,
    amount_subtotal: 499,
    amount_total: 499,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    currency: "usd",
    metadata,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    for (const u of [owner, other]) {
      await db?.delete(schema.purchase).where(eq(schema.purchase.userId, u.id));
      await db?.delete(schema.qrCode).where(eq(schema.qrCode.userId, u.id));
      await db?.delete(schema.user).where(eq(schema.user.id, u.id));
    }
    await pool?.end();
  });

  it("binds one pending order to the account and the code before Stripe; payment fulfils that order and that code only", async () => {
    const a = await code(owner.id, "bound");
    const second = await code(owner.id, "bound"); // same account, same content, its own code
    const { port, sessions } = stripe();
    const r = await singleQrCheckout(db, port, { userId: owner.id, ...a, charge });
    expect(r).toMatchObject({ ok: true, reused: false });
    const [order] = await ordersOf(a.qrCodeId);
    expect(order).toMatchObject({ userId: owner.id, qrCodeId: a.qrCodeId, status: "pending", item: "single_qr", amountTotal: 499 });
    const sessionId = order?.stripeCheckoutSessionId ?? "";
    expect(sessions.get(sessionId)).toEqual({ orderId: order?.id, status: "open" });

    const meta = { userId: owner.id, qrCodeId: a.qrCodeId, orderId: order?.id ?? "", kind: "code" };
    expect(await fulfillCheckout(db, paidEvent(sessionId, meta), () => "s")).toMatchObject({ granted: true });
    const [paid] = await ordersOf(a.qrCodeId);
    expect(paid).toMatchObject({
      id: order?.id,
      userId: owner.id,
      qrCodeId: a.qrCodeId,
      status: "paid",
      stripeCheckoutSessionId: sessionId,
    });
    expect(await unlocked(a.qrCodeId)).toBe(true);
    expect(await unlocked(second.qrCodeId)).toBe(false);
    // Duplicate delivery: nothing changes.
    expect(await fulfillCheckout(db, paidEvent(sessionId, meta), () => "s")).toMatchObject({ granted: false });
    expect(await ordersOf(a.qrCodeId)).toHaveLength(1);
    // Asking again for the unlocked code: no order, no session.
    expect(await singleQrCheckout(db, port, { userId: owner.id, ...a, charge })).toEqual({ ok: false, error: "owned" });
    expect(sessions.size).toBe(1);
  });

  it("refuses another account's code, a layout of another code and a deleted code: no order, no session", async () => {
    const mine = await code(owner.id, "mine");
    const theirs = await code(other.id, "theirs");
    const { port, state } = stripe();
    expect(await singleQrCheckout(db, port, { userId: owner.id, ...theirs, charge })).toEqual({ ok: false, error: "not_found" });
    expect(await singleQrCheckout(db, port, { userId: owner.id, qrCodeId: mine.qrCodeId, layoutId: theirs.layoutId, charge })).toEqual({
      ok: false,
      error: "not_found",
    });
    await db.update(schema.qrCode).set({ deletedAt: new Date() }).where(eq(schema.qrCode.id, mine.qrCodeId));
    expect(await singleQrCheckout(db, port, { userId: owner.id, ...mine, charge })).toEqual({ ok: false, error: "not_found" });
    expect(state.creates).toBe(0);
    expect(await ordersOf(mine.qrCodeId)).toHaveLength(0);
    expect(await ordersOf(theirs.qrCodeId)).toHaveLength(0);
  });

  it("a failed session creation leaves the order pending; the retry reuses it and replaces only an open session", async () => {
    const a = await code(owner.id, "retry");
    const { port, sessions, state } = stripe();
    state.failNext = true;
    await expect(singleQrCheckout(db, port, { userId: owner.id, ...a, charge })).rejects.toThrow("Stripe unavailable");
    const [failed] = await ordersOf(a.qrCodeId);
    expect(failed).toMatchObject({ status: "pending", stripeCheckoutSessionId: null });

    const retry = await singleQrCheckout(db, port, { userId: owner.id, ...a, charge });
    expect(retry).toMatchObject({ ok: true, reused: true, orderId: failed?.id });
    const first = (await ordersOf(a.qrCodeId))[0]?.stripeCheckoutSessionId ?? "";
    // Back from Stripe without paying, then Pay again: the open session is expired, the same order gets a new one.
    const again = await singleQrCheckout(db, port, { userId: owner.id, ...a, charge });
    expect(again).toMatchObject({ ok: true, reused: true, orderId: failed?.id });
    const rows = await ordersOf(a.qrCodeId);
    expect(rows).toHaveLength(1);
    expect(sessions.get(first)?.status).toBe("expired");
    expect(sessions.get(rows[0]?.stripeCheckoutSessionId ?? "")?.status).toBe("open");
    // The replaced session can no longer pay the order (its event matches no order).
    expect(await fulfillCheckout(db, paidEvent(first, { userId: owner.id, qrCodeId: a.qrCodeId }), () => "s")).toMatchObject({
      granted: false,
    });
    expect(await unlocked(a.qrCodeId)).toBe(false);
  });

  it("an attempt already paid is never charged again; unpaid or mismatched events leave the code locked", async () => {
    const a = await code(owner.id, "processing");
    const { port, sessions, state } = stripe();
    await singleQrCheckout(db, port, { userId: owner.id, ...a, charge });
    const [order] = await ordersOf(a.qrCodeId);
    const sessionId = order?.stripeCheckoutSessionId ?? "";
    const meta = { userId: owner.id, qrCodeId: a.qrCodeId, orderId: order?.id ?? "" };
    // Unpaid (e.g. a delayed method) and events naming another order, account or code: no grant, still pending.
    expect(await fulfillCheckout(db, paidEvent(sessionId, meta, "unpaid"), () => "s")).toMatchObject({ granted: false });
    expect(await fulfillCheckout(db, paidEvent(sessionId, { ...meta, orderId: "another" }), () => "s")).toMatchObject({ granted: false });
    expect(await fulfillCheckout(db, paidEvent(sessionId, { ...meta, userId: other.id }), () => "s")).toMatchObject({ granted: false });
    const b = await code(owner.id, "other code");
    expect(await fulfillCheckout(db, paidEvent(sessionId, { ...meta, qrCodeId: b.qrCodeId }), () => "s")).toMatchObject({ granted: false });
    expect((await ordersOf(a.qrCodeId))[0]?.status).toBe("pending");
    expect(await unlocked(a.qrCodeId)).toBe(false);
    expect(await unlocked(b.qrCodeId)).toBe(false);
    // The session completed at Stripe (webhook not processed yet): Pay again opens no second checkout.
    const s = sessions.get(sessionId);
    if (s) s.status = "complete";
    const creates = state.creates;
    expect(await singleQrCheckout(db, port, { userId: owner.id, ...a, charge })).toEqual({ ok: false, error: "processing" });
    expect(state.creates).toBe(creates);
  });

  it("two checkouts of the same code at once share one order, and only one session is left payable", async () => {
    const a = await code(owner.id, "double click");
    const { port, sessions } = stripe();
    const results = await Promise.all([
      singleQrCheckout(db, port, { userId: owner.id, ...a, charge }),
      singleQrCheckout(db, port, { userId: owner.id, ...a, charge }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await ordersOf(a.qrCodeId);
    expect(rows).toHaveLength(1);
    const open = [...sessions.entries()].filter(([, v]) => v.status === "open").map(([k]) => k);
    expect(open).toEqual([rows[0]?.stripeCheckoutSessionId]);
  });

  it("a paid order still waiting for the webhook is found with its original settings; open, expired and unpaid ones are not (HEY-92)", async () => {
    const a = await code(owner.id, "awaiting");
    const { port } = stripe();
    await singleQrCheckout(db, port, { userId: owner.id, ...a, charge });
    const [order] = await ordersOf(a.qrCodeId);
    const sessionId = order?.stripeCheckoutSessionId ?? "";
    const back = `https://heyqr.test/en/create/export?qr=${a.qrCodeId}&layout=${a.layoutId}&format=png&res=600&transparent=1&printPack=1&checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const lookups: string[] = [];
    const as =
      (status: string | null, payment_status: string, success_url: string | null = back): SessionLookup =>
      async (id) => {
        lookups.push(id);
        return { status, payment_status, success_url };
      };

    const found = await awaitingFulfillment(db, as("complete", "paid"), owner.id, a.qrCodeId);
    expect(found).toMatchObject({ orderId: order?.id, sessionId });
    expect(Object.fromEntries(found?.settings ?? [])).toEqual({
      layout: a.layoutId,
      format: "png",
      res: "600",
      transparent: "1",
      printPack: "1",
    });
    expect(lookups).toEqual([sessionId]);
    // Cancelled (still open), expired, or complete without payment (a delayed method): nothing awaits, Pay stays retryable.
    expect(await awaitingFulfillment(db, as("open", "unpaid"), owner.id, a.qrCodeId)).toBeNull();
    expect(await awaitingFulfillment(db, as("expired", "unpaid"), owner.id, a.qrCodeId)).toBeNull();
    expect(await awaitingFulfillment(db, as("complete", "unpaid"), owner.id, a.qrCodeId)).toBeNull();
    // Another account never sees this order; Stripe isn't even asked.
    const before = lookups.length;
    expect(await awaitingFulfillment(db, as("complete", "paid"), other.id, a.qrCodeId)).toBeNull();
    expect(lookups).toHaveLength(before);
    // A return URL for another code carries no settings over.
    const elsewhere = await awaitingFulfillment(db, as("complete", "paid", back.replace(a.qrCodeId, "another")), owner.id, a.qrCodeId);
    expect(elsewhere?.settings.toString()).toBe("");
    // Once the webhook has fulfilled it, nothing awaits.
    expect(
      await fulfillCheckout(db, paidEvent(sessionId, { userId: owner.id, qrCodeId: a.qrCodeId, orderId: order?.id ?? "" }), () => "s"),
    ).toMatchObject({ granted: true });
    expect(await awaitingFulfillment(db, as("complete", "paid"), owner.id, a.qrCodeId)).toBeNull();
  });

  it("a checkout that never got a session awaits nothing", async () => {
    const a = await code(owner.id, "no session");
    const { port, state } = stripe();
    state.failNext = true;
    await expect(singleQrCheckout(db, port, { userId: owner.id, ...a, charge })).rejects.toThrow();
    const lookup = vi.fn<SessionLookup>();
    expect(await awaitingFulfillment(db, lookup, owner.id, a.qrCodeId)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("HEY-96: a payment that doesn't match its stored order changes nothing; the matching one is paid once", async () => {
    const a = await code(owner.id, "verified");
    const other = await code(owner.id, "verified"); // same account, same content
    const { port } = stripe();
    const lines = [
      { offer: "single" as const, amount: 499 },
      { offer: "printPack" as const, amount: 299 },
    ];
    const both = { item: "single_qr_print_pack" as const, lines, currency: "USD" };
    await singleQrCheckout(db, port, { userId: owner.id, ...a, charge: both });
    const replaced = (await ordersOf(a.qrCodeId))[0]?.stripeCheckoutSessionId ?? "";
    await singleQrCheckout(db, port, { userId: owner.id, ...a, charge: both }); // the retry replaces that session
    const [order] = await ordersOf(a.qrCodeId);
    const sessionId = order?.stripeCheckoutSessionId ?? "";
    expect(sessionId).not.toBe(replaced);
    const meta = { userId: owner.id, qrCodeId: a.qrCodeId, orderId: order?.id ?? "", kind: "code", printPack: "1" };
    // Valid: the order's items (798), a promotion code (-100) and automatic tax on top (+56).
    const valid = {
      ...paidEvent(sessionId, meta),
      amount_subtotal: 798,
      amount_total: 754,
      total_details: { amount_discount: 100, amount_shipping: 0, amount_tax: 56 },
    };
    const unchanged = async () => {
      const row = await db.query.purchase.findFirst({ where: eq(schema.purchase.id, order?.id ?? "") });
      expect(row).toMatchObject({ status: "pending", paidAt: null, stripePaymentIntentId: null, amountTotal: order?.amountTotal });
      const codes = await db.query.qrCode.findMany({ where: inArray(schema.qrCode.id, [a.qrCodeId, other.qrCodeId]) });
      expect(codes.map((c) => [c.purchasedAt, c.printPackAt])).toEqual([
        [null, null],
        [null, null],
      ]);
    };
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((m: unknown) => void warnings.push(String(m)));
    try {
      const rejected: [string, object][] = [
        [
          "subtotal_mismatch",
          { ...valid, amount_subtotal: 499, amount_total: 499, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 } },
        ],
        ["total_mismatch", { ...valid, amount_total: 1 }],
        ["currency_mismatch", { ...valid, currency: "pln" }],
        ["missing_amounts", { ...valid, amount_subtotal: null }],
        ["not_paid", { ...valid, status: "complete", payment_status: "unpaid" }],
        ["not_paid", { ...valid, status: "expired", payment_status: "unpaid" }],
        ["no_order", { ...valid, id: replaced }],
        ["owner_mismatch", { ...valid, metadata: { ...meta, userId: other.qrCodeId } }],
        ["qr_mismatch", { ...valid, metadata: { ...meta, qrCodeId: other.qrCodeId } }],
        ["order_mismatch", { ...valid, metadata: { ...meta, orderId: "another" } }],
      ];
      for (const [reason, event] of rejected) {
        expect(await fulfillCheckout(db, event as typeof valid, () => "s")).toEqual({ granted: false, reason });
        await unchanged();
      }
      // Diagnostics: the reason and ids only, never the payload (metadata, amounts, payment intent).
      expect(warnings.map((w) => w.split(" ")[4])).toEqual([
        "subtotal_mismatch",
        "total_mismatch",
        "currency_mismatch",
        "missing_amounts",
        "no_order",
        "owner_mismatch",
        "qr_mismatch",
        "order_mismatch",
      ]);
      for (const w of warnings) expect(w).not.toMatch(/pi_|metadata|amount_|@|printPack|754|798/);

      expect(await fulfillCheckout(db, valid, () => "s")).toMatchObject({ granted: true });
      const paid = await db.query.purchase.findFirst({ where: eq(schema.purchase.id, order?.id ?? "") });
      // Paid as charged; the expected items stay as they were bought.
      expect(paid).toMatchObject({ status: "paid", amountTotal: 754, stripeCheckoutSessionId: sessionId, lines });
      const bought = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, a.qrCodeId) });
      expect(bought?.purchasedAt).not.toBeNull();
      expect(bought?.printPackAt).not.toBeNull();
      expect(await unlocked(other.qrCodeId)).toBe(false);
      // Repeat delivery: nothing changes, nothing logged.
      const count = warnings.length;
      expect(await fulfillCheckout(db, valid, () => "s")).toEqual({ granted: false, reason: "already_paid" });
      const again = await db.query.purchase.findFirst({ where: eq(schema.purchase.id, order?.id ?? "") });
      expect(again?.paidAt).toEqual(paid?.paidAt);
      expect(warnings).toHaveLength(count);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps earlier order history: a legacy pending order with its session is reused, paid orders are untouched", async () => {
    const a = await code(owner.id, "legacy");
    const { port, sessions } = stripe();
    sessions.set("cs_test_legacy_open", { orderId: "legacy", status: "open" });
    await db.insert(schema.purchase).values([
      {
        id: "hey88-legacy-paid",
        userId: owner.id,
        qrCodeId: null,
        item: "pack3",
        stripeCheckoutSessionId: "cs_test_legacy_paid",
        amountTotal: 999,
        currency: "usd",
        status: "paid",
        paidAt: new Date(),
      },
      {
        id: "hey88-legacy",
        userId: owner.id,
        qrCodeId: a.qrCodeId,
        item: "single_qr",
        stripeCheckoutSessionId: "cs_test_legacy_open",
        amountTotal: 499,
        currency: "usd",
      },
    ]);
    const r = await singleQrCheckout(db, port, { userId: owner.id, ...a, charge });
    expect(r).toMatchObject({ ok: true, reused: true, orderId: "hey88-legacy" });
    expect(sessions.get("cs_test_legacy_open")?.status).toBe("expired");
    const paid = await db.query.purchase.findFirst({ where: eq(schema.purchase.id, "hey88-legacy-paid") });
    expect(paid).toMatchObject({ status: "paid", stripeCheckoutSessionId: "cs_test_legacy_paid", amountTotal: 999 });
  });
});

/* HEY-97: a checkout event, its paid order and the order's grants commit together or not at all. */
describe.skipIf(!url)("atomic one-time fulfilment (HEY-97, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey97-owner", name: "Owner", email: "owner@hey97.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  let n = 0;
  const uid = (p: string) => `hey97-${p}-${++n}-${Math.random().toString(36).slice(2, 7)}`;
  const code = async (text: string) => {
    const r = await saveQrWithLayouts(db, owner.id, { name: text, model: "static", content: { type: "text", text }, layouts });
    if (!r.ok) throw new Error("fixture");
    return r.data.qrCodeId;
  };
  type Line = { offer: "single" | "printPack" | "pack3" | "pack10"; amount: number };
  const ITEMS = {
    single_qr: [{ offer: "single", amount: 499 }],
    single_qr_print_pack: [
      { offer: "single", amount: 499 },
      { offer: "printPack", amount: 299 },
    ],
    print_pack: [{ offer: "printPack", amount: 299 }],
    pack3: [{ offer: "pack3", amount: 1199 }],
    pack10: [{ offer: "pack10", amount: 2499 }],
  } satisfies Record<string, Line[]>;
  /** A pending order with its attached session, as checkout leaves it. */
  const order = async (item: keyof typeof ITEMS, qrCodeId: string | null) => {
    const id = uid("order");
    const lines = ITEMS[item];
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    await db.insert(schema.purchase).values({
      id,
      userId: owner.id,
      qrCodeId,
      item,
      lines,
      stripeCheckoutSessionId: `cs_test_${id}`,
      amountTotal: amount,
      currency: "usd",
    });
    return { id, sessionId: `cs_test_${id}`, amount, qrCodeId };
  };
  const event = (o: Awaited<ReturnType<typeof order>>, type = "checkout.session.completed", id = uid("evt")) => ({
    id,
    type,
    session: {
      id: o.sessionId,
      mode: "payment" as const,
      status: "complete" as const,
      payment_status: "paid" as const,
      payment_intent: `pi_${o.id}`,
      amount_subtotal: o.amount,
      amount_total: o.amount,
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      currency: "usd",
      metadata: { userId: owner.id, orderId: o.id, ...(o.qrCodeId ? { qrCodeId: o.qrCodeId } : {}) },
    },
  });
  const row = async (orderId: string) => db.query.purchase.findFirst({ where: eq(schema.purchase.id, orderId) });
  const qr = async (id: string) => db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, id) });
  const claimed = async (eventId: string) =>
    (await pool.query(`select count(*)::int as n from webhook_event where id = $1`, [eventId])).rows[0].n;
  /** A real database error inside the grant, after the order update (a trigger on the grant's own write). */
  const failing = async (sql: string, run: () => Promise<unknown>) => {
    await pool.query(
      `create or replace function hey97_fail() returns trigger language plpgsql as $$ begin raise exception 'hey97 injected failure'; end $$`,
    );
    await pool.query(sql);
    try {
      await run();
    } finally {
      await pool.query(
        `drop trigger if exists hey97_fail on qr_code; drop trigger if exists hey97_fail on credit_ledger; drop function if exists hey97_fail()`,
      );
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await pool?.query(`delete from webhook_event where id like 'hey97-%'`);
    await db?.delete(schema.creditLedger).where(eq(schema.creditLedger.userId, owner.id));
    await db?.delete(schema.purchase).where(eq(schema.purchase.userId, owner.id));
    await db?.delete(schema.qrCode).where(eq(schema.qrCode.userId, owner.id));
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("a failure after the order update rolls back the order, the grants and the event; the retry grants once", async () => {
    const q = await code("rollback");
    const o = await order("single_qr_print_pack", q);
    const e = event(o);
    // The grant (the code's unlock) fails after the order was moved to paid in the same transaction.
    await failing(
      `create trigger hey97_fail before update on qr_code for each row when (new.id = '${q}') execute function hey97_fail()`,
      async () => {
        await expect(processCheckoutEvent(db, e, () => "s")).rejects.toThrow();
      },
    );
    expect(await row(o.id)).toMatchObject({ status: "pending", paidAt: null, stripePaymentIntentId: null, amountTotal: o.amount });
    expect(await qr(q)).toMatchObject({ purchasedAt: null, printPackAt: null, status: "draft" });
    expect(await claimed(e.id)).toBe(0);

    // Stripe retries the same event: one successful grant.
    expect(await processCheckoutEvent(db, e, () => "s")).toMatchObject({
      duplicate: false,
      result: { granted: true, receipt: { qrCodeId: q } },
    });
    const paid = await row(o.id);
    expect(paid).toMatchObject({ status: "paid", amountTotal: o.amount });
    const unlocked = await qr(q);
    expect(unlocked?.purchasedAt).not.toBeNull();
    expect(unlocked?.printPackAt).not.toBeNull();
    expect(await claimed(e.id)).toBe(1);
    expect(await processCheckoutEvent(db, e, () => "s")).toEqual({ duplicate: true });
    expect((await row(o.id))?.paidAt).toEqual(paid?.paidAt);
  });

  it("a pack whose credit write fails rolls back too; the retry credits it once", async () => {
    const o = await order("pack3", null);
    const e = event(o);
    const before = await creditBalance(db, owner.id);
    await failing(
      `create trigger hey97_fail before insert on credit_ledger for each row when (new.purchase_id = '${o.id}') execute function hey97_fail()`,
      async () => {
        await expect(processCheckoutEvent(db, e, () => "s")).rejects.toThrow();
      },
    );
    expect((await row(o.id))?.status).toBe("pending");
    expect(await creditBalance(db, owner.id)).toBe(before);
    expect(await claimed(e.id)).toBe(0);
    expect(await processCheckoutEvent(db, e, () => "s")).toMatchObject({ duplicate: false, result: { granted: true } });
    expect(await creditBalance(db, owner.id)).toBe(before + 3);
  });

  it("the same event at once, then two distinct completion events for one session: one paid transition, one set of grants", async () => {
    const q = await code("concurrent");
    const o = await order("single_qr", q);
    const e = event(o);
    const same = await Promise.all([1, 2, 3, 4].map(() => processCheckoutEvent(db, e, () => "s")));
    expect(same.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(same.filter((r) => !r.duplicate && r.result.granted)).toHaveLength(1);
    const paid = await row(o.id);
    const unlockedAt = (await qr(q))?.purchasedAt;
    expect(paid?.status).toBe("paid");
    expect(unlockedAt).not.toBeNull();
    // Stripe also sends async_payment_succeeded (another event id) for the same session: processed, nothing granted.
    expect(await processCheckoutEvent(db, event(o, "checkout.session.async_payment_succeeded"), () => "s")).toEqual({
      duplicate: false,
      result: { granted: false, reason: "already_paid" },
    });
    expect((await row(o.id))?.paidAt).toEqual(paid?.paidAt);
    expect((await qr(q))?.purchasedAt).toEqual(unlockedAt);

    // Two distinct completion events for a fresh order, at the same moment.
    const q2 = await code("concurrent distinct");
    const o2 = await order("single_qr_print_pack", q2);
    const both = await Promise.all(
      [event(o2), event(o2, "checkout.session.async_payment_succeeded")].map((ev) => processCheckoutEvent(db, ev, () => "s")),
    );
    expect(both.every((r) => !r.duplicate)).toBe(true);
    expect(both.filter((r) => !r.duplicate && r.result.granted)).toHaveLength(1);
    expect(both.filter((r) => !r.duplicate && !r.result.granted && r.result.reason === "already_paid")).toHaveLength(1);
    expect((await row(o2.id))?.status).toBe("paid");
  });

  it("credits: duplicate fulfilment of a pack credits it once", async () => {
    const o = await order("pack10", null);
    const before = await creditBalance(db, owner.id);
    const e = event(o);
    const results = await Promise.all(
      [e, e, event(o), event(o, "checkout.session.async_payment_succeeded")].map((ev) => processCheckoutEvent(db, ev, () => "s")),
    );
    expect(results.filter((r) => !r.duplicate && r.result.granted)).toHaveLength(1);
    expect(await creditBalance(db, owner.id)).toBe(before + 10);
    const rows = await db.query.creditLedger.findMany({ where: eq(schema.creditLedger.purchaseId, o.id) });
    expect(rows).toEqual([expect.objectContaining({ delta: 10, reason: "pack10" })]);
  });

  it("credits: two codes competing for the last credit make exactly one debit and one unlock", async () => {
    // Spend down to exactly one credit.
    let balance = await creditBalance(db, owner.id);
    while (balance > 1) {
      const spent = await unlockStatic(db, owner.id, await code(`spend ${balance}`), "credit");
      expect(spent.ok).toBe(true);
      balance = await creditBalance(db, owner.id);
    }
    if (balance < 1) {
      const o = await order("pack3", null);
      await processCheckoutEvent(db, event(o), () => "s");
      for (let i = 0; i < 2; i++) await unlockStatic(db, owner.id, await code(`spend extra ${i}`), "credit");
    }
    expect(await creditBalance(db, owner.id)).toBe(1);
    const [a, b] = [await code("last credit A"), await code("last credit B")];
    const debitsBefore = (await db.query.creditLedger.findMany({ where: eq(schema.creditLedger.userId, owner.id) })).filter(
      (r) => r.reason === "unlock",
    ).length;
    const results = await Promise.all([unlockStatic(db, owner.id, a, "credit"), unlockStatic(db, owner.id, b, "credit")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "no_credits")).toHaveLength(1);
    const debits = (await db.query.creditLedger.findMany({ where: eq(schema.creditLedger.userId, owner.id) })).filter(
      (r) => r.reason === "unlock",
    );
    expect(debits.length - debitsBefore).toBe(1);
    const unlocked = [(await qr(a))?.purchasedAt, (await qr(b))?.purchasedAt].filter((d) => d !== null && d !== undefined);
    expect(unlocked).toHaveLength(1);
    expect(await creditBalance(db, owner.id)).toBe(0);
  });

  it("grants are independent: a standalone Print Pack keeps the base export; Single QR + Print Pack keeps an earlier Print Pack", async () => {
    const q = await code("base then print pack");
    const base = await order("single_qr", q);
    await processCheckoutEvent(db, event(base), () => "s");
    const unlocked = await qr(q);
    expect(unlocked?.purchasedAt).not.toBeNull();
    expect(unlocked?.printPackAt).toBeNull();
    const pp = await order("print_pack", q);
    expect(await processCheckoutEvent(db, event(pp), () => "s")).toEqual({ duplicate: false, result: { granted: true } });
    const after = await qr(q);
    expect(after?.printPackAt).not.toBeNull();
    expect(after?.purchasedAt).toEqual(unlocked?.purchasedAt);
    expect(after?.status).toBe("active");

    // A code that already had its Print Pack (e.g. from a plan) keeps that time when Single QR + Print Pack is paid.
    const q2 = await code("print pack first");
    const earlier = new Date("2026-11-01T00:00:00Z");
    await db.update(schema.qrCode).set({ printPackAt: earlier }).where(eq(schema.qrCode.id, q2));
    const both = await order("single_qr_print_pack", q2);
    await processCheckoutEvent(db, event(both), () => "s");
    const bothAfter = await qr(q2);
    expect(bothAfter?.purchasedAt).not.toBeNull();
    expect(bothAfter?.printPackAt).toEqual(earlier);
  });
});

/* HEY-100: confirmed Stripe refunds revoke what they paid for, once, line by line, from the stored order. */
describe.skipIf(!url)("refund entitlements (HEY-100, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey100-owner", name: "Owner", email: "owner@hey100.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  let n = 0;
  const uid = (p: string) => `hey100-${p}-${++n}-${Math.random().toString(36).slice(2, 7)}`;
  const code = async (text: string) => {
    const r = await saveQrWithLayouts(db, owner.id, { name: text, model: "static", content: { type: "text", text }, layouts });
    if (!r.ok) throw new Error("fixture");
    return r.data.qrCodeId;
  };
  const ITEMS = {
    single_qr: [{ offer: "single", amount: 499 }],
    single_qr_print_pack: [
      { offer: "single", amount: 499 },
      { offer: "printPack", amount: 299 },
    ],
    print_pack: [{ offer: "printPack", amount: 299 }],
    pack3: [{ offer: "pack3", amount: 1199 }],
    pack10: [{ offer: "pack10", amount: 2499 }],
  } as const;
  type Order = { id: string; sessionId: string; pi: string; amount: number; qrCodeId: string | null };
  const order = async (item: keyof typeof ITEMS, qrCodeId: string | null): Promise<Order> => {
    const id = uid("order");
    const lines = ITEMS[item].map((l) => ({ ...l }));
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    await db.insert(schema.purchase).values({
      id,
      userId: owner.id,
      qrCodeId,
      item,
      lines,
      stripeCheckoutSessionId: `cs_test_${id}`,
      amountTotal: amount,
      currency: "usd",
    });
    return { id, sessionId: `cs_test_${id}`, pi: `pi_${id}`, amount, qrCodeId };
  };
  const pay = (o: Order, type = "checkout.session.completed") =>
    processCheckoutEvent(
      db,
      {
        id: uid("evt"),
        type,
        session: {
          id: o.sessionId,
          mode: "payment",
          status: "complete",
          payment_status: "paid",
          payment_intent: o.pi,
          amount_subtotal: o.amount,
          amount_total: o.amount,
          total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
          currency: "usd",
          metadata: { userId: owner.id, orderId: o.id, ...(o.qrCodeId ? { qrCodeId: o.qrCodeId } : {}) },
        },
      },
      () => "s",
    );
  const bought = async (item: keyof typeof ITEMS, qrCodeId: string | null) => {
    const o = await order(item, qrCodeId);
    expect(await pay(o)).toMatchObject({ duplicate: false, result: { granted: true } });
    return o;
  };
  const noLookup: PaymentLookup = async () => {
    throw new Error("not expected");
  };
  const refundEvent = (o: Order, amount: number, lines?: string, over: { id?: string; status?: string; eventId?: string } = {}) => ({
    id: over.eventId ?? uid("evt"),
    type: "refund.updated",
    refund: {
      id: over.id ?? uid("re"),
      status: over.status ?? "succeeded",
      amount,
      currency: "usd",
      payment_intent: o.pi,
      metadata: (lines === undefined ? {} : { heyqr_lines: lines }) as Record<string, string>,
    },
  });
  const qr = async (id: string) => db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, id) });
  const status = async (o: Order) => (await db.query.purchase.findFirst({ where: eq(schema.purchase.id, o.id) }))?.status;
  const refundRow = async (id: string) => db.query.refund.findFirst({ where: eq(schema.refund.id, id) });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await pool?.query(`delete from webhook_event where id like 'hey100-%'`);
    await db?.delete(schema.refund).where(eq(schema.refund.userId, owner.id));
    await pool?.query(`delete from refund where id like 'hey100-%'`);
    await db?.delete(schema.creditLedger).where(eq(schema.creditLedger.userId, owner.id));
    await db?.delete(schema.allowanceUse).where(eq(schema.allowanceUse.userId, owner.id));
    await db?.delete(schema.purchase).where(eq(schema.purchase.userId, owner.id));
    await db?.delete(schema.qrCode).where(eq(schema.qrCode.userId, owner.id));
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("Print Pack line of a combined order: revokes the Print Pack, keeps the base; applied once however it's delivered", async () => {
    const q = await code("combined pp refund");
    const o = await bought("single_qr_print_pack", q);
    const before = await qr(q);
    const e = refundEvent(o, 299, "printPack");
    // The same event three times at once, then the same refund through another event (refund.created).
    const results = await Promise.all([e, e, e].map((ev) => processRefundEvent(db, ev, noLookup)));
    expect(results.filter((r) => !r.duplicate)).toEqual([
      { duplicate: false, outcome: "applied", lines: ["printPack"], creditsRemoved: 0 },
    ]);
    expect(await processRefundEvent(db, { ...e, id: uid("evt"), type: "refund.created" }, noLookup)).toEqual({ duplicate: true });
    const after = await qr(q);
    expect(after?.printPackAt).toBeNull();
    expect(after?.purchasedAt).toEqual(before?.purchasedAt);
    expect(after?.status).toBe("active");
    expect(await status(o)).toBe("paid");
    // A late payment event (redelivery, or the async twin) can't bring the Print Pack back.
    expect(await pay(o, "checkout.session.async_payment_succeeded")).toMatchObject({ result: { granted: false, reason: "already_paid" } });
    expect((await qr(q))?.printPackAt).toBeNull();
    // Refunding the same line again is recorded for review, not applied twice.
    expect(await processRefundEvent(db, refundEvent(o, 299, "printPack"), noLookup)).toMatchObject({
      outcome: "review",
      reason: "line_already_refunded",
    });
  });

  it("a partial refund is never guessed: without an explicit allocation, or with an inconsistent one, it's recorded for review", async () => {
    const q = await code("ambiguous");
    const o = await bought("single_qr_print_pack", q);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const cases: [ReturnType<typeof refundEvent>, string][] = [
        [refundEvent(o, 299), "partial_unallocated"], // the Print Pack's price, but not allocated to it
        [refundEvent(o, 250, "printPack"), "allocation_amount_mismatch"],
        [refundEvent(o, 299, "pack3"), "unknown_line"],
        [refundEvent(o, 299, ""), "unknown_line"],
        [{ ...refundEvent(o, 798), refund: { ...refundEvent(o, 798).refund, currency: "pln" } }, "currency_mismatch"],
      ];
      for (const [ev, reason] of cases) {
        expect(await processRefundEvent(db, ev, noLookup)).toEqual({ duplicate: false, outcome: "review", reason });
        expect(await refundRow(ev.refund.id)).toMatchObject({
          outcome: "review",
          reason,
          purchaseId: o.id,
          lines: null,
          creditsRemoved: 0,
        });
      }
      const still = await qr(q);
      expect(still?.purchasedAt).not.toBeNull();
      expect(still?.printPackAt).not.toBeNull();
      expect(await status(o)).toBe("paid");
      expect(warn.mock.calls.map(([m]) => String(m).split(" ")[5])).toEqual([
        "partial_unallocated",
        "allocation_amount_mismatch",
        "unknown_line",
        "unknown_line",
        "currency_mismatch",
      ]);
      for (const [m] of warn.mock.calls) expect(String(m)).not.toMatch(/heyqr_lines|metadata|pi_|@|299|798/);
    } finally {
      warn.mockRestore();
    }
    // A refund that isn't confirmed (pending) changes nothing and isn't even claimed.
    const pending = refundEvent(o, 798, undefined, { status: "pending" });
    expect(await processRefundEvent(db, pending, noLookup)).toEqual({ duplicate: false, outcome: "ignored", reason: "not_succeeded" });
    expect(await refundRow(pending.refund.id)).toBeUndefined();
    // A payment we don't know.
    const unknown = { ...refundEvent(o, 100), refund: { ...refundEvent(o, 100).refund, payment_intent: "pi_unknown" } };
    expect(await processRefundEvent(db, unknown, async () => ({ sessionId: null, amountPaid: null }))).toMatchObject({
      outcome: "review",
      reason: "unknown_order",
    });
  });

  it("a full base refund revokes the base from that purchase only; other grants and other codes stay", async () => {
    const q = await code("base refund");
    const other = await code("unrelated");
    const o = await bought("single_qr", q);
    await bought("single_qr", other);
    expect(await processRefundEvent(db, refundEvent(o, 499), noLookup)).toMatchObject({ outcome: "applied", lines: ["single"] });
    expect(await qr(q)).toMatchObject({ purchasedAt: null, status: "draft" });
    expect(await status(o)).toBe("refunded");
    expect((await qr(other))?.purchasedAt).not.toBeNull();
    // A late payment event for the refunded order: closed, nothing granted.
    expect(await pay(o)).toMatchObject({ result: { granted: false, reason: "order_closed" } });
    expect((await qr(q))?.purchasedAt).toBeNull();

    // The same code also unlocked by a credit or a plan allowance: refunding the purchase keeps the unlock.
    for (const source of ["credit", "allowance"] as const) {
      const c = await code(`two sources ${source}`);
      const paid = await bought("single_qr", c);
      const ledgerId = uid("led");
      if (source === "credit")
        await db.insert(schema.creditLedger).values({ id: ledgerId, userId: owner.id, delta: -1, reason: "unlock", qrCodeId: c });
      else
        await db
          .insert(schema.allowanceUse)
          .values({ id: uid("al"), userId: owner.id, kind: "static_unlock", qrCodeId: c, periodStart: new Date() });
      expect(await processRefundEvent(db, refundEvent(paid, 499), noLookup)).toMatchObject({ outcome: "applied" });
      expect((await qr(c))?.purchasedAt).not.toBeNull();
      // That debit had no pack behind it (a fixture): gone again so the credit tests start from zero.
      await db.delete(schema.creditLedger).where(eq(schema.creditLedger.id, ledgerId));
    }
  });

  it("combined orders: the base line alone keeps the Print Pack row but print access needs the base; a full refund revokes both", async () => {
    const q = await code("base line only");
    const o = await bought("single_qr_print_pack", q);
    expect(await processRefundEvent(db, refundEvent(o, 499, "single"), noLookup)).toMatchObject({ outcome: "applied", lines: ["single"] });
    const after = await qr(q);
    // canDownloadPrintPack requires the base unlock (entitlements.ts), so the print files are refused now.
    expect(after?.purchasedAt).toBeNull();
    expect(after?.printPackAt).not.toBeNull();
    expect(await status(o)).toBe("paid");
    // The rest of the order (the Print Pack line) refunded next: the order is refunded.
    expect(await processRefundEvent(db, refundEvent(o, 299), noLookup)).toMatchObject({ outcome: "applied", lines: ["printPack"] });
    expect(await status(o)).toBe("refunded");
    expect((await qr(q))?.printPackAt).toBeNull();

    const q2 = await code("full combined");
    const o2 = await bought("single_qr_print_pack", q2);
    expect(await processRefundEvent(db, refundEvent(o2, 798), noLookup)).toMatchObject({
      outcome: "applied",
      lines: ["single", "printPack"],
    });
    expect(await qr(q2)).toMatchObject({ purchasedAt: null, printPackAt: null, status: "draft" });
  });

  it("a standalone Print Pack refunded in full: only the Print Pack goes; the base from its own purchase stays", async () => {
    const q = await code("standalone pp");
    await bought("single_qr", q);
    const pp = await bought("print_pack", q);
    const before = await qr(q);
    expect(await processRefundEvent(db, refundEvent(pp, 299), noLookup)).toMatchObject({ outcome: "applied", lines: ["printPack"] });
    const after = await qr(q);
    expect(after?.printPackAt).toBeNull();
    expect(after?.purchasedAt).toEqual(before?.purchasedAt);
    expect(await status(pp)).toBe("refunded");
  });

  it("a refund that arrives before the payment event: the late payment grants only what wasn't refunded", async () => {
    const q = await code("refund first, print pack");
    const o = await order("single_qr_print_pack", q);
    const lookup: PaymentLookup = async () => ({ sessionId: o.sessionId, amountPaid: 798 });
    expect(await processRefundEvent(db, refundEvent(o, 299, "printPack"), lookup)).toMatchObject({
      outcome: "applied",
      lines: ["printPack"],
    });
    expect(await status(o)).toBe("pending");
    expect(await pay(o)).toMatchObject({ result: { granted: true } });
    const after = await qr(q);
    expect(after?.purchasedAt).not.toBeNull();
    expect(after?.printPackAt).toBeNull();
    expect(await status(o)).toBe("paid");

    const q2 = await code("refund first, full");
    const o2 = await order("single_qr", q2);
    expect(await processRefundEvent(db, refundEvent(o2, 499), async () => ({ sessionId: o2.sessionId, amountPaid: 499 }))).toMatchObject({
      outcome: "applied",
      lines: ["single"],
    });
    expect(await status(o2)).toBe("refunded");
    expect(await pay(o2)).toMatchObject({ result: { granted: false, reason: "order_closed" } });
    expect((await qr(q2))?.purchasedAt).toBeNull();
  });

  it("a refunded pack loses its unused credits (first in, first out); codes unlocked with its spent credits stay", async () => {
    const balance = () => creditBalance(db, owner.id);
    const start = await balance();
    expect(start).toBe(0);
    const pack = await bought("pack3", null);
    const spent = await code("spent credit");
    expect(await unlockStatic(db, owner.id, spent, "credit")).toMatchObject({ ok: true });
    expect(await processRefundEvent(db, refundEvent(pack, 1199), noLookup)).toEqual({
      duplicate: false,
      outcome: "applied",
      lines: ["pack3"],
      creditsRemoved: 2,
    });
    expect(await balance()).toBe(0);
    expect((await qr(spent))?.purchasedAt).not.toBeNull();
    expect(await status(pack)).toBe("refunded");

    // Two packs: spending takes the oldest first, so refunding the older one finds nothing unused.
    const a = await bought("pack3", null);
    const b = await bought("pack10", null);
    for (let i = 0; i < 4; i++) expect((await unlockStatic(db, owner.id, await code(`fifo ${i}`), "credit")).ok).toBe(true);
    expect(Object.fromEntries(await unusedPackCredits(db, owner.id))).toMatchObject({ [a.id]: 0, [b.id]: 9 });
    expect(await processRefundEvent(db, refundEvent(a, 1199), noLookup)).toMatchObject({ outcome: "applied", creditsRemoved: 0 });
    expect(await balance()).toBe(9);
    expect(await processRefundEvent(db, refundEvent(b, 2499), noLookup)).toMatchObject({ outcome: "applied", creditsRemoved: 9 });
    expect(await balance()).toBe(0);
  });

  it("a pack refund racing the redemption of its last credit: one of them wins, the balance never goes below zero", async () => {
    for (let round = 0; round < 4; round++) {
      expect(await creditBalance(db, owner.id)).toBe(0);
      const pack = await bought("pack3", null);
      for (let i = 0; i < 2; i++) expect((await unlockStatic(db, owner.id, await code(`race ${round} ${i}`), "credit")).ok).toBe(true);
      expect(await creditBalance(db, owner.id)).toBe(1);
      const last = await code(`race ${round} last`);
      const [refund, unlock] = await Promise.all([
        processRefundEvent(db, refundEvent(pack, 1199), noLookup),
        unlockStatic(db, owner.id, last, "credit"),
      ]);
      expect(refund).toMatchObject({ outcome: "applied" });
      const removed = refund.duplicate === false && refund.outcome === "applied" ? refund.creditsRemoved : -1;
      const unlocked = (await qr(last))?.purchasedAt !== null;
      // Either the redemption took the credit (nothing left to remove) or the refund removed it (redemption refused).
      expect([unlocked && unlock.ok && removed === 0, !unlocked && !unlock.ok && removed === 1].filter(Boolean)).toHaveLength(1);
      expect(await creditBalance(db, owner.id)).toBe(0);
    }
  });
});

/* HEY-117 / QR-16.02: a code's short link is assigned once, atomically, and never changes afterwards. */
describe.skipIf(!url)("permanent short links (HEY-117, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "slug-owner", name: "Owner", email: "owner@slug.test", stripeCustomerId: "cus_slug_owner" };
  const card = { ...DEFAULT_DESIGN, preset: "caption" as const, caption: "Menu" };
  const layouts = [{ name: "Card", layout: designToLayout(card), editor: designSettingsOf(card) }];
  const first = "https://menu.example.test/first";
  const make = async (name: string) => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name,
      model: "dynamic",
      content: { type: "website", url: first },
      destination: first,
      layouts,
    });
    if (!saved.ok) throw new Error("save failed");
    return saved.data.qrCodeId;
  };
  const qr = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });
  const sequence = (...values: string[]) => {
    const calls: string[] = [];
    const next = () => {
      const v = values[calls.length] ?? `${values[values.length - 1]}${calls.length}`;
      calls.push(v);
      return v;
    };
    return Object.assign(next, { calls });
  };
  const subscriptionEvent = (id: string, qrCodeId: string) => ({
    id,
    type: "checkout.session.completed",
    session: {
      id: `cs_${id}`,
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      payment_intent: null,
      amount_subtotal: 900,
      amount_total: 900,
      total_details: null,
      currency: "usd",
      customer: owner.stripeCustomerId,
      metadata: { userId: owner.id, qrCodeId },
    } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    // A plan for activation under a plan, and a running trial for the trial path, on the same account.
    await db.insert(schema.subscription).values({
      id: "slug-sub",
      userId: owner.id,
      stripeSubscriptionId: "sub_slug_test",
      stripePriceId: "price_x",
      status: "active",
      plan: "studio",
      activeCodeLimit: 25,
      currentPeriodStart: new Date(),
    });
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("a forced collision retries with a fresh slug; the code that holds it keeps it", async () => {
    const holder = await make("Holder");
    expect(await activateDynamicCode(db, owner.id, holder, () => "taken01")).toEqual({ ok: true, shortCode: "taken01" });
    const next = await make("Next");
    const gen = sequence("taken01", "taken01", "fresh01");
    expect(await activateDynamicCode(db, owner.id, next, gen)).toEqual({ ok: true, shortCode: "fresh01" });
    expect(gen.calls).toEqual(["taken01", "taken01", "fresh01"]);
    expect([(await qr(holder))?.shortCode, (await qr(next))?.shortCode, (await qr(next))?.status]).toEqual([
      "taken01",
      "fresh01",
      "active",
    ]);
  });

  it("gives up after a bounded number of attempts; the activation rolls back", async () => {
    const stuck = await make("Stuck");
    const gen = sequence("taken01");
    await expect(activateDynamicCode(db, owner.id, stuck, () => gen() && "taken01")).rejects.toBeInstanceOf(ShortCodeExhaustedError);
    expect(gen.calls).toHaveLength(SHORT_CODE_ATTEMPTS);
    const row = await qr(stuck);
    expect([row?.shortCode, row?.status]).toEqual([null, "draft"]);
    // The subscription webhook rolls back the same way (event included), so Stripe's retry is processed again.
    const event = subscriptionEvent("evt_slug_stuck", stuck);
    await expect(processCheckoutEvent(db, event, () => "taken01")).rejects.toBeInstanceOf(ShortCodeExhaustedError);
    expect(await db.query.webhookEvent.findFirst({ where: (w, { eq }) => eq(w.id, event.id) })).toBeUndefined();
    expect(await processCheckoutEvent(db, event, () => "stuck01")).toEqual({ duplicate: false, result: { granted: true } });
    expect((await qr(stuck))?.shortCode).toBe("stuck01");
  });

  it("first-time activation through trial, plan and subscription Checkout at once converges on one slug", async () => {
    await db.update(schema.user).set({ trialStartedAt: null, trialEndsAt: null }).where(eq(schema.user.id, owner.id));
    expect((await startTrial(db, owner.id, false)).ok).toBe(true);
    for (let round = 0; round < 6; round++) {
      // The trial has one test-code slot; free it for each round.
      await db
        .update(schema.qrCode)
        .set({ deletedAt: new Date() })
        .where(and(eq(schema.qrCode.userId, owner.id), eq(schema.qrCode.isTrial, true)));
      const id = await make(`Race ${round}`);
      const [trial, plan, webhook, again] = await Promise.all([
        activateTrialCode(db, owner.id, id, () => `trl${round}aaa`),
        activateDynamicCode(db, owner.id, id, () => `pln${round}bbb`),
        processCheckoutEvent(db, subscriptionEvent(`evt_slug_race_${round}`, id), () => `sub${round}ccc`),
        activateDynamicCode(db, owner.id, id, () => `pln${round}ddd`),
      ]);
      const stored = (await qr(id))?.shortCode;
      expect(stored).toMatch(new RegExp(`^(trl${round}aaa|pln${round}bbb|sub${round}ccc|pln${round}ddd)$`));
      for (const r of [trial, plan, again]) expect(r).toEqual({ ok: true, shortCode: stored });
      expect(webhook).toEqual({ duplicate: false, result: { granted: true } });
      expect((await qr(id))?.status).toBe("active");
    }
    await db.update(schema.user).set({ trialStartedAt: null, trialEndsAt: null }).where(eq(schema.user.id, owner.id));
  });

  it("the subscription webhook waits for the account lock before it touches the code row (the CI deadlock)", async () => {
    // The interleaving that deadlocked: an activation holds the account row (trial and plan activation lock it first)
    // while the webhook for the same code runs. The webhook must queue on the account row, not take the code row first:
    // then the activation can write the code row and commit, and the webhook converges on its slug.
    const id = await make("Interleaving");
    const holder = await pool.connect();
    const watcher = await pool.connect();
    let webhook: Promise<unknown> | undefined;
    try {
      const activation = drizzle(holder, { schema, casing: "snake_case" });
      const stored = await activation.transaction(async (tx) => {
        await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, owner.id)).for("update");
        webhook = processCheckoutEvent(db, subscriptionEvent("evt_slug_interleave", id), () => "subzzz9");
        let waiting: string | undefined;
        for (let i = 0; i < 200 && !waiting; i++) {
          const r = await watcher.query(
            "select query from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock'",
          );
          waiting = r.rows[0]?.query;
          if (!waiting) await new Promise((done) => setTimeout(done, 10));
        }
        expect(waiting).toMatch(/from "user" where "user"\."id" = \$1 for update/);
        // The code row is still free: the webhook hasn't written it.
        expect((await watcher.query("select id from qr_code where id = $1 for update nowait", [id])).rowCount).toBe(1);
        return assignShortCode(tx, id, () => "plnzzz9");
      });
      expect(await webhook).toEqual({ duplicate: false, result: { granted: true } });
      const row = await qr(id);
      expect([stored, row?.shortCode, row?.status, row?.isTrial]).toEqual(["plnzzz9", "plnzzz9", "active", false]);
    } finally {
      await webhook?.catch(() => undefined);
      holder.release();
      watcher.release();
    }
  });

  it("concurrent assignments for one code all return the slug that was stored", async () => {
    const id = await make("Same path");
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => assignShortCode(db, id, () => `same0${i}x`)));
    const stored = (await qr(id))?.shortCode;
    expect(new Set(results)).toEqual(new Set([stored]));
  });

  it("keeps the issued slug across saves, destination changes and reactivation", async () => {
    const id = await make("Keeps");
    expect(await activateDynamicCode(db, owner.id, id, () => "keep001")).toEqual({ ok: true, shortCode: "keep001" });
    // A design save of the published code, even one carrying another address, keeps the slug and the destination
    // (HEY-124: only Change destination publishes a URL).
    const saved = await saveQrWithLayouts(db, owner.id, {
      qrCodeId: id,
      name: "Keeps (renamed)",
      model: "dynamic",
      content: { type: "website", url: first },
      destination: "https://menu.example.test/second",
      layouts,
    });
    expect(saved.ok).toBe(true);
    expect([(await qr(id))?.shortCode, (await qr(id))?.destination]).toEqual(["keep001", first]);
    // The intentional change, through Change destination.
    expect(await changeFresh(db, owner.id, id, "https://menu.example.test/third")).toMatchObject({
      ok: true,
      data: { destination: "https://menu.example.test/third", previousDestination: first },
    });
    // Paused, then activated again under the plan, then the plan Checkout delivered for it.
    await db.update(schema.qrCode).set({ status: "paused" }).where(eq(schema.qrCode.id, id));
    expect(await activateDynamicCode(db, owner.id, id, () => "other01")).toEqual({ ok: true, shortCode: "keep001" });
    expect(await processCheckoutEvent(db, subscriptionEvent("evt_slug_keep", id), () => "other02")).toMatchObject({ duplicate: false });
    const row = await qr(id);
    expect([row?.shortCode, row?.destination, row?.status]).toEqual(["keep001", "https://menu.example.test/third", "active"]);
  });

  it("the database refuses changing or clearing an issued slug; the first assignment from NULL is allowed", async () => {
    const id = await make("Guarded");
    await db.update(schema.qrCode).set({ shortCode: "guard01" }).where(eq(schema.qrCode.id, id));
    const refused = async (shortCode: string | null) => {
      const error = await db
        .update(schema.qrCode)
        .set({ shortCode })
        .where(eq(schema.qrCode.id, id))
        .then(
          () => null,
          (e: unknown) => e,
        );
      return (error as { cause?: { code?: string } } | null)?.cause?.code;
    };
    expect(await refused("guard02")).toBe("23000");
    expect(await refused(null)).toBe("23000");
    // Writing the same value, and updates that don't touch the slug, still work.
    await db.update(schema.qrCode).set({ shortCode: "guard01", name: "Guarded 2" }).where(eq(schema.qrCode.id, id));
    expect((await qr(id))?.shortCode).toBe("guard01");
  });
});

/* HEY-119 / QR-16.04: one destination check on create and on Change destination; the slug never moves. */
describe.skipIf(!url)("Dynamic destinations (HEY-119, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "dest-owner", name: "Owner", email: "owner@dest.test" };
  const other = { id: "dest-other", name: "Other", email: "other@dest.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const save = (model: "static" | "dynamic", url: string, destination?: string) =>
    saveQrWithLayouts(db, owner.id, { name: "Menu", model, content: { type: "website", url }, destination, layouts });
  const qr = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("create keeps http:// and https:// exactly, defaults a bare domain to https:// and refuses invalid ones", async () => {
    const stored = async (r: Awaited<ReturnType<typeof save>>) => (r.ok ? (await qr(r.data.qrCodeId))?.destination : r);
    expect(await stored(await save("dynamic", "http://menu.example.test/a?x=1#top", "http://menu.example.test/a?x=1#top"))).toBe(
      "http://menu.example.test/a?x=1#top",
    );
    expect(await stored(await save("dynamic", "https://menu.example.test/b?y=2#z"))).toBe("https://menu.example.test/b?y=2#z");
    expect(await stored(await save("dynamic", "menu.example.test/c"))).toBe("https://menu.example.test/c");
    const before = await db.$count(schema.qrCode, eq(schema.qrCode.userId, owner.id));
    for (const bad of ["ftp://files.example.test", "javascript:alert(1)", "not a url", "localhost"])
      expect(await save("dynamic", "menu.example.test", bad)).toMatchObject({ ok: false, error: "invalid", field: "destination" });
    expect(await save("dynamic", "nope")).toMatchObject({ ok: false, field: "destination", problem: "invalid" });
    expect(await db.$count(schema.qrCode, eq(schema.qrCode.userId, owner.id))).toBe(before);
    // A static code has no destination, whatever is sent.
    expect(await stored(await save("static", "https://static.example.test", "https://elsewhere.example.test"))).toBeNull();
  });

  it("Change destination: https → http → https with query and fragment; a refused address changes nothing", async () => {
    const saved = await save("dynamic", "https://menu.example.test/start");
    if (!saved.ok) throw new Error("save failed");
    const id = saved.data.qrCodeId;
    await db.update(schema.qrCode).set({ shortCode: "dest001", status: "active" }).where(eq(schema.qrCode.id, id));

    expect(await changeFresh(db, owner.id, id, "http://plain.example.test/menu?table=4&lang=en#drinks")).toMatchObject({
      ok: true,
      data: { destination: "http://plain.example.test/menu?table=4&lang=en#drinks" },
    });
    expect(await changeFresh(db, owner.id, id, "secure.example.test/menu?table=5#food")).toMatchObject({
      ok: true,
      data: { destination: "https://secure.example.test/menu?table=5#food" },
    });
    let row = await qr(id);
    expect([row?.destination, row?.previousDestination, row?.shortCode]).toEqual([
      "https://secure.example.test/menu?table=5#food",
      "http://plain.example.test/menu?table=4&lang=en#drinks",
      "dest001",
    ]);

    for (const bad of ["ftp://files.example.test", "javascript:alert(1)", "", "two words.example.test", 42])
      expect(await changeFresh(db, owner.id, id, bad)).toMatchObject({ ok: false, error: "invalid", field: "destination" });
    expect(await changeFresh(db, other.id, id, "https://other.example.test")).toEqual({ ok: false, error: "not_found" });
    row = await qr(id);
    expect([row?.destination, row?.previousDestination, row?.shortCode, row?.status]).toEqual([
      "https://secure.example.test/menu?table=5#food",
      "http://plain.example.test/menu?table=4&lang=en#drinks",
      "dest001",
      "active",
    ]);
  });

  it("a static code has no destination to change", async () => {
    const saved = await save("static", "https://static.example.test/x");
    if (!saved.ok) throw new Error("save failed");
    expect(await changeFresh(db, owner.id, saved.data.qrCodeId, "https://new.example.test")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

/* HEY-123 / QR-17.01: the most recent destination change (previous URL and server time) is stored and shown again. */
describe.skipIf(!url)("destination change metadata (HEY-123, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "change-owner", name: "Owner", email: "owner@change.test" };
  const other = { id: "change-other", name: "Other", email: "other@change.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const reload = async (id: string) => {
    const row = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });
    return {
      destination: row?.destination,
      previousDestination: row?.previousDestination,
      changedAt: row?.destinationChangedAt?.toISOString() ?? null,
      revision: row?.destinationRevision,
      shortCode: row?.shortCode,
    };
  };
  const live = async (slug: string) => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Menu",
      model: "dynamic",
      content: { type: "website", url: "https://first.example.test/menu" },
      layouts,
    });
    if (!saved.ok) throw new Error("save failed");
    await db.update(schema.qrCode).set({ shortCode: slug, status: "active" }).where(eq(schema.qrCode.id, saved.data.qrCodeId));
    return saved.data.qrCodeId;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("an actual change stores the previous URL and the server's time together and returns them; a reload reads the same", async () => {
    const id = await live("chg0001");
    expect(await reload(id)).toEqual({
      destination: "https://first.example.test/menu",
      previousDestination: null,
      changedAt: null,
      revision: 0,
      shortCode: "chg0001",
    });
    const [{ now: before }] = (await pool.query("select now() as now")).rows as { now: Date }[];
    const first = await changeFresh(db, owner.id, id, "https://second.example.test/menu?x=1#y");
    if (!first.ok) throw new Error("change failed");
    expect(first.data).toMatchObject({
      destination: "https://second.example.test/menu?x=1#y",
      previousDestination: "https://first.example.test/menu",
    });
    expect(new Date(first.data.changedAt ?? 0).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await reload(id)).toEqual({ ...first.data, shortCode: "chg0001" });

    // The next change keeps only the most recent one (full history is HEY-125).
    const second = await changeFresh(db, owner.id, id, "http://third.example.test/");
    if (!second.ok) throw new Error("change failed");
    expect(second.data.previousDestination).toBe("https://second.example.test/menu?x=1#y");
    expect(new Date(second.data.changedAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(first.data.changedAt ?? 0).getTime());
    expect(await reload(id)).toEqual({ ...second.data, shortCode: "chg0001" });
  });

  it("the same URL, invalid input and another account leave the previous URL and time intact", async () => {
    const id = await live("chg0002");
    const changed = await changeFresh(db, owner.id, id, "https://second.example.test/");
    if (!changed.ok) throw new Error("change failed");
    const stored = await reload(id);
    // The same address (also typed as a bare domain): nothing written, the stored change returned as it was.
    expect(await changeFresh(db, owner.id, id, "https://second.example.test/")).toEqual({ ok: true, data: changed.data });
    expect(await changeFresh(db, owner.id, id, "second.example.test/")).toEqual({ ok: true, data: changed.data });
    for (const bad of ["ftp://files.example.test", "not a url", ""])
      expect(await changeFresh(db, owner.id, id, bad)).toMatchObject({ ok: false, error: "invalid", field: "destination" });
    expect(await changeFresh(db, other.id, id, "https://other.example.test")).toEqual({ ok: false, error: "not_found" });
    expect(await reload(id)).toEqual(stored);
  });

  it("an older row with a previous URL but no time keeps the URL; the next actual change records a time", async () => {
    const id = await live("chg0003");
    await db.update(schema.qrCode).set({ previousDestination: "https://legacy.example.test/" }).where(eq(schema.qrCode.id, id));
    expect(await changeFresh(db, owner.id, id, "https://first.example.test/menu")).toEqual({
      ok: true,
      data: {
        destination: "https://first.example.test/menu",
        previousDestination: "https://legacy.example.test/",
        changedAt: null,
        revision: 0,
      },
    });
    const next = await changeFresh(db, owner.id, id, "https://new.example.test/");
    expect(next.ok && next.data.changedAt !== null && next.data.previousDestination === "https://first.example.test/menu").toBe(true);
  });
});

/* HEY-124 / QR-17.02: saving a design never publishes a URL; Change destination is the only way to publish one. */
describe.skipIf(!url)("design saves keep the published destination (HEY-124, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "keepdest-owner", name: "Owner", email: "owner@keepdest.test" };
  const original = "https://first.example.test/menu";
  const card = (caption: string) => ({ ...DEFAULT_DESIGN, preset: "caption" as const, caption });
  const layoutsOf = (caption: string, id?: string) => [
    { id, name: "Card", layout: designToLayout(card(caption)), editor: designSettingsOf(card(caption)) },
  ];
  const create = async () => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Menu",
      model: "dynamic",
      content: { type: "website", url: original },
      destination: original,
      layouts: layoutsOf("Scan me"),
    });
    if (!saved.ok) throw new Error("save failed");
    return saved.data;
  };
  const row = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });
  const caption = async (qrCodeId: string) =>
    (await db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, qrCodeId) })).map((l) => {
      const read = readLayoutRecord(l.design);
      return read.ok ? read.value.editor?.caption : read.reason;
    });
  const published = (r: Awaited<ReturnType<typeof row>>) => ({
    shortCode: r?.shortCode,
    destination: r?.destination,
    previousDestination: r?.previousDestination,
    changedAt: r?.destinationChangedAt?.toISOString() ?? null,
    revision: r?.destinationRevision,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("a new Dynamic code keeps its initial destination", async () => {
    const { qrCodeId } = await create();
    expect((await row(qrCodeId))?.destination).toBe(original);
  });

  it("a stale design save after another tab published a new URL keeps the new URL, its metadata and the slug", async () => {
    const { qrCodeId, layoutIds } = await create();
    await db.update(schema.qrCode).set({ shortCode: "keepd01", status: "active" }).where(eq(schema.qrCode.id, qrCodeId));
    // Tab B publishes a new address.
    const changed = await changeFresh(db, owner.id, qrCodeId, "http://second.example.test/menu?x=1#y");
    if (!changed.ok) throw new Error("change failed");
    const before = published(await row(qrCodeId));
    expect(before).toEqual({ shortCode: "keepd01", ...changed.data });
    // Tab A, opened before the change, saves a design edit carrying the old address.
    const stale = await saveQrWithLayouts(db, owner.id, {
      qrCodeId,
      name: "Menu (edited)",
      model: "dynamic",
      content: { type: "website", url: original },
      destination: original,
      layouts: layoutsOf("Edited in tab A", layoutIds[0]),
    });
    expect(stale).toMatchObject({ ok: true, data: { qrCodeId, layoutIds } });
    const after = await row(qrCodeId);
    expect(published(after)).toEqual(before);
    expect([after?.name, await caption(qrCodeId)]).toEqual(["Menu (edited)", ["Edited in tab A"]]);
    // A save without any destination keeps it too.
    expect(
      (
        await saveQrWithLayouts(db, owner.id, {
          qrCodeId,
          name: "Menu",
          model: "dynamic",
          content: { type: "website", url: original },
          layouts: layoutsOf("Again", layoutIds[0]),
        })
      ).ok,
    ).toBe(true);
    expect(published(await row(qrCodeId))).toEqual(before);
  });

  it("publishing a URL leaves the saved layouts intact", async () => {
    const { qrCodeId } = await create();
    await db.update(schema.qrCode).set({ shortCode: "keepd02", status: "active" }).where(eq(schema.qrCode.id, qrCodeId));
    const layoutsBefore = await db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, qrCodeId) });
    expect((await changeFresh(db, owner.id, qrCodeId, "https://third.example.test/")).ok).toBe(true);
    expect(await db.query.qrLayout.findMany({ where: (l, { eq }) => eq(l.qrCodeId, qrCodeId) })).toEqual(layoutsBefore);
  });

  it("an unpublished Dynamic draft may still update its destination; a static code never gets one", async () => {
    const { qrCodeId, layoutIds } = await create();
    const resaved = await saveQrWithLayouts(db, owner.id, {
      qrCodeId,
      name: "Menu",
      model: "dynamic",
      content: { type: "website", url: "https://draft.example.test/menu" },
      layouts: layoutsOf("Scan me", layoutIds[0]),
    });
    expect(resaved.ok).toBe(true);
    expect([(await row(qrCodeId))?.destination, (await row(qrCodeId))?.destinationChangedAt]).toEqual([
      "https://draft.example.test/menu",
      null,
    ]);
    const stat = await saveQrWithLayouts(db, owner.id, {
      name: "Static",
      model: "static",
      content: { type: "website", url: original },
      layouts: layoutsOf("S"),
    });
    if (!stat.ok) throw new Error("save failed");
    // Saved again as if it were dynamic: the stored model decides, and a static code keeps no destination.
    expect(
      (
        await saveQrWithLayouts(db, owner.id, {
          qrCodeId: stat.data.qrCodeId,
          name: "Static",
          model: "dynamic",
          content: { type: "website", url: original },
          destination: "https://sneaky.example.test/",
          layouts: layoutsOf("S", stat.data.layoutIds[0]),
        })
      ).ok,
    ).toBe(true);
    const s = await row(stat.data.qrCodeId);
    expect([s?.model, s?.destination]).toEqual(["static", null]);
  });
});

/* HEY-125 / QR-17.03: every actual destination change is recorded with the change itself; only the owner reads it. */
describe.skipIf(!url)("destination change history (HEY-125, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hist-owner", name: "Owner", email: "owner@hist.test" };
  const other = { id: "hist-other", name: "Other", email: "other@hist.test" };
  const A = "https://a.example.test/menu";
  const B = "http://b.example.test/menu?x=1#y";
  const C = "https://c.example.test/";
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const live = async (slug: string) => {
    const saved = await saveQrWithLayouts(db, owner.id, { name: "Menu", model: "dynamic", content: { type: "website", url: A }, layouts });
    if (!saved.ok) throw new Error("save failed");
    await db.update(schema.qrCode).set({ shortCode: slug, status: "active" }).where(eq(schema.qrCode.id, saved.data.qrCodeId));
    return saved.data;
  };
  const rows = (qrCodeId: string) => db.$count(schema.destinationChange, eq(schema.destinationChange.qrCodeId, qrCodeId));
  const code = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("A → B → C records two changes, newest first, with the change's own time; saving C again and invalid input add none", async () => {
    const { qrCodeId } = await live("hist001");
    // Creating the code with A is not a change.
    expect(await rows(qrCodeId)).toBe(0);
    const toB = await changeFresh(db, owner.id, qrCodeId, B);
    const toC = await changeFresh(db, owner.id, qrCodeId, C);
    if (!toB.ok || !toC.ok) throw new Error("change failed");
    const history = await destinationHistory(db, owner.id, qrCodeId);
    expect(history.map((h) => [h.previousUrl, h.newUrl, h.changedAt])).toEqual([
      [B, C, toC.data.changedAt],
      [A, B, toB.data.changedAt],
    ]);
    expect(history[0]?.id).toBeGreaterThan(history[1]?.id ?? Infinity);
    // The last change shown since HEY-123 is the newest entry.
    const row = await code(qrCodeId);
    expect([row?.destination, row?.previousDestination, row?.destinationChangedAt?.toISOString()]).toEqual([C, B, history[0]?.changedAt]);

    expect(await changeFresh(db, owner.id, qrCodeId, C)).toEqual({ ok: true, data: toC.data });
    expect(await changeFresh(db, owner.id, qrCodeId, "c.example.test/")).toEqual({ ok: true, data: toC.data });
    for (const bad of ["ftp://files.example.test", "not a url", ""])
      expect((await changeFresh(db, owner.id, qrCodeId, bad)).ok).toBe(false);
    expect(await destinationHistory(db, owner.id, qrCodeId)).toEqual(history);
  });

  it("a failed history write rolls back the publication and the history together", async () => {
    const { qrCodeId } = await live("hist002");
    expect((await changeFresh(db, owner.id, qrCodeId, B)).ok).toBe(true);
    const before = await code(qrCodeId);
    const historyBefore = await destinationHistory(db, owner.id, qrCodeId);
    // Make the history insert itself fail, after the destination row was updated in the same transaction.
    await pool.query(`
      create or replace function hey125_refuse() returns trigger language plpgsql as $$
      begin raise exception 'history write refused (test)'; end $$;
      create trigger hey125_refuse before insert on destination_change for each row execute function hey125_refuse();
    `);
    try {
      await expect(changeFresh(db, owner.id, qrCodeId, C)).rejects.toThrow();
    } finally {
      await pool.query("drop trigger hey125_refuse on destination_change; drop function hey125_refuse();");
    }
    const after = await code(qrCodeId);
    expect([after?.destination, after?.previousDestination, after?.destinationChangedAt, after?.shortCode]).toEqual([
      before?.destination,
      before?.previousDestination,
      before?.destinationChangedAt,
      "hist002",
    ]);
    expect(await destinationHistory(db, owner.id, qrCodeId)).toEqual(historyBefore);
    // With the write possible again, the same change succeeds once.
    expect((await changeFresh(db, owner.id, qrCodeId, C)).ok).toBe(true);
    expect(await rows(qrCodeId)).toBe(historyBefore.length + 1);
  });

  it("only the owner reads the history; a deleted code has none to show", async () => {
    const { qrCodeId } = await live("hist003");
    expect((await changeFresh(db, owner.id, qrCodeId, B)).ok).toBe(true);
    expect(await destinationHistory(db, owner.id, qrCodeId)).toHaveLength(1);
    expect(await destinationHistory(db, other.id, qrCodeId)).toEqual([]);
    await softDeleteQrCodes(db, owner.id, [qrCodeId]);
    expect(await destinationHistory(db, owner.id, qrCodeId)).toEqual([]);
  });

  it("saving a design records no destination change", async () => {
    const { qrCodeId, layoutIds } = await live("hist004");
    const saved = await saveQrWithLayouts(db, owner.id, {
      qrCodeId,
      name: "Menu (edited)",
      model: "dynamic",
      content: { type: "website", url: A },
      destination: "https://stale.example.test/",
      layouts: [{ id: layoutIds[0], ...layouts[0] }],
    });
    expect(saved.ok).toBe(true);
    expect([(await code(qrCodeId))?.destination, await rows(qrCodeId)]).toEqual([A, 0]);
  });

  it("changes that share a timestamp keep a stable order (newest insert first)", async () => {
    const { qrCodeId } = await live("hist005");
    const at = new Date("2026-11-23T12:00:00Z");
    await db.insert(schema.destinationChange).values([
      { qrCodeId, previousUrl: A, newUrl: B, changedAt: at },
      { qrCodeId, previousUrl: B, newUrl: C, changedAt: at },
    ]);
    const first = await destinationHistory(db, owner.id, qrCodeId);
    expect(first.map((h) => h.newUrl)).toEqual([C, B]);
    expect(await destinationHistory(db, owner.id, qrCodeId)).toEqual(first);
  });
});

/*
 * HEY-126 / QR-17.04: a slug, once issued, is never issued again: not after its code is purged, not after its account
 * is deleted (cascade). PostgreSQL keeps every issued slug in short_code_reservation (migration 0012).
 */
describe.skipIf(!url)("short link registry (HEY-126, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "reg-owner", name: "Owner", email: "owner@registry.test" };
  const leaving = { id: "reg-leaving", name: "Leaving", email: "leaving@registry.test" };
  // Its own account, so the drafts the other tests leave don't count against the draft limit.
  const racer = { id: "reg-racer", name: "Racer", email: "racer@registry.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const A = "https://menu.example.test/a";
  const B = "https://menu.example.test/b";
  const make = async (name: string, userId = owner.id) => {
    const saved = await saveQrWithLayouts(db, userId, {
      name,
      model: "dynamic",
      content: { type: "website", url: A },
      destination: A,
      layouts,
    });
    if (!saved.ok) throw new Error("save failed");
    return saved.data.qrCodeId;
  };
  const sequence = (...values: string[]) => {
    const calls: string[] = [];
    const next = () => {
      const v = values[Math.min(calls.length, values.length - 1)] as string;
      calls.push(v);
      return v;
    };
    return Object.assign(next, { calls });
  };
  /** What /r/<slug> answers (src/app/r/[code]/route.ts: the same lookup and the same checks, for non-trial codes). */
  const shortLink = async (slug: string) => {
    const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.shortCode, slug) });
    return !qr || qr.deletedAt || qr.status !== "active" || !qr.destination ? "unavailable" : qr.destination;
  };
  const reserved = async (slug: string) =>
    (await pool.query("select * from short_code_reservation where short_code = $1", [slug])).rows as Record<string, unknown>[];
  /** The PostgreSQL error a write failed with (drizzle wraps it as the cause). */
  const pgError = (write: Promise<unknown>) =>
    write.then(
      () => undefined,
      (e: unknown) => {
        for (let x: unknown = e; x instanceof Error; x = x.cause) {
          const pg = x as { code?: string; constraint?: string };
          if (pg.code) return { code: pg.code, constraint: pg.constraint };
        }
        throw e;
      },
    );
  const plan = (userId: string) => ({
    id: `${userId}-sub`,
    userId,
    stripeSubscriptionId: `sub_${userId}`,
    stripePriceId: "price_x",
    status: "active" as const,
    plan: "studio" as const,
    activeCodeLimit: 25,
    currentPeriodStart: new Date(),
  });
  /** Waits until another session is blocked on a lock. */
  const blockedOnLock = async (watcher: { query: Pool["query"] }) => {
    for (let i = 0; i < 300; i++) {
      const r = await watcher.query(
        "select 1 from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock'",
      );
      if (r.rowCount) return true;
      await new Promise((done) => setTimeout(done, 10));
    }
    return false;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, leaving, racer]).onConflictDoNothing();
    await db.insert(schema.subscription).values([plan(owner.id), plan(leaving.id)]);
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, leaving.id, racer.id]));
    await pool?.end();
  });

  it("migration 0012 backfills every slug still stored, live or soft-deleted, and nothing else", async () => {
    const migration = readFileSync(fileURLToPath(new URL("../../../drizzle/0012_short_code_reservation.sql", import.meta.url)), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      // The database as it was before 0012, with a slug purged before the migration ran.
      await client.query(`
        drop function qr_code_reserve_short_code() cascade;
        drop table short_code_reservation;
        drop function short_code_reservation_permanent() cascade;
        insert into "user" (id, name, email, email_verified) values ('bf-user', 'Legacy', 'legacy@registry.test', false);
        insert into qr_code (id, user_id, name, content, model, status, short_code, destination, deleted_at) values
          ('bf-live', 'bf-user', 'Live', '{}', 'dynamic', 'active', 'bfliv01', '${A}', null),
          ('bf-soft', 'bf-user', 'Soft-deleted', '{}', 'dynamic', 'active', 'bfsoft1', '${A}', now()),
          ('bf-draft', 'bf-user', 'Draft', '{}', 'dynamic', 'draft', null, '${A}', null),
          ('bf-purged', 'bf-user', 'Purged', '{}', 'dynamic', 'active', 'bfgone1', '${A}', null);
        delete from qr_code where id = 'bf-purged';
      `);
      for (const statement of migration.split("--> statement-breakpoint")) await client.query(statement);

      const stored = await client.query("select short_code from qr_code where short_code is not null order by 1");
      const registry = await client.query("select short_code from short_code_reservation order by 1");
      expect(registry.rows).toEqual(stored.rows);
      const slugs = registry.rows.map((r: { short_code: string }) => r.short_code);
      expect(slugs).toEqual(expect.arrayContaining(["bfliv01", "bfsoft1"]));
      // A slug purged before the migration left no trace to reserve it from.
      expect(slugs).not.toContain("bfgone1");
      // From here on PostgreSQL reserves on issue.
      await client.query(`update qr_code set short_code = 'bfdraf1' where id = 'bf-draft'`);
      expect((await client.query(`select 1 from short_code_reservation where short_code = 'bfdraf1'`)).rowCount).toBe(1);
    } finally {
      await client.query("rollback");
      client.release();
    }
    // The test database is as before: the registry and its triggers are back, the legacy rows gone.
    expect(await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, "bf-live") })).toBeUndefined();
    expect(await reserved("bfdraf1")).toEqual([]);
  });

  it("after a code is purged, the allocator's retry gives the next code a new slug; the old link stays unavailable", async () => {
    const gone = await make("Purged");
    expect(await activateDynamicCode(db, owner.id, gone, () => "gone001")).toEqual({ ok: true, shortCode: "gone001" });
    expect(await shortLink("gone001")).toBe(A);
    await db.delete(schema.qrCode).where(eq(schema.qrCode.id, gone));
    expect(await shortLink("gone001")).toBe("unavailable");
    // The reservation keeps the slug only: nothing about the code, its account or where it pointed.
    expect(await reserved("gone001")).toEqual([{ short_code: "gone001" }]);

    const next = await make("Next");
    const gen = sequence("gone001", "new0001");
    expect(await activateDynamicCode(db, owner.id, next, gen)).toEqual({ ok: true, shortCode: "new0001" });
    expect(gen.calls).toEqual(["gone001", "new0001"]);
    expect([await shortLink("gone001"), await shortLink("new0001")]).toEqual(["unavailable", A]);

    // Enforced in PostgreSQL, also for writes that bypass the allocator: a first-time assignment and an insert.
    const draft = await make("Bypass");
    expect(await pgError(db.update(schema.qrCode).set({ shortCode: "gone001" }).where(eq(schema.qrCode.id, draft)))).toEqual({
      code: "23505",
      constraint: "short_code_reservation_pkey",
    });
    expect((await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, draft) }))?.shortCode).toBeNull();
    expect(
      await pgError(
        db.insert(schema.qrCode).values({
          id: "reg-insert",
          userId: owner.id,
          name: "Inserted",
          model: "dynamic",
          status: "active",
          content: { type: "website", url: B },
          shortCode: "gone001",
          destination: B,
        }),
      ),
    ).toEqual({ code: "23505", constraint: "short_code_reservation_pkey" });
    expect(await shortLink("gone001")).toBe("unavailable");
  });

  it("after an account is deleted (its codes cascade), its slugs are never issued to another account", async () => {
    const theirs = await make("Theirs", leaving.id);
    expect(await activateDynamicCode(db, leaving.id, theirs, () => "casc001")).toEqual({ ok: true, shortCode: "casc001" });
    await db.delete(schema.user).where(eq(schema.user.id, leaving.id));
    expect(await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, theirs) })).toBeUndefined();
    expect(await shortLink("casc001")).toBe("unavailable");
    expect(await reserved("casc001")).toEqual([{ short_code: "casc001" }]);

    const mine = await make("Mine");
    const gen = sequence("casc001", "casc002");
    expect(await activateDynamicCode(db, owner.id, mine, gen)).toEqual({ ok: true, shortCode: "casc002" });
    expect(gen.calls).toEqual(["casc001", "casc002"]);
    expect([await shortLink("casc001"), await shortLink("casc002")]).toEqual(["unavailable", A]);
  });

  it("soft-delete and Undo: the restored code gets its own slug back, and keeps it through a destination change", async () => {
    const id = await make("Undo");
    expect(await activateDynamicCode(db, owner.id, id, () => "undo001")).toEqual({ ok: true, shortCode: "undo001" });
    expect(await softDeleteQrCodes(db, owner.id, [id])).toEqual([id]);
    expect(await shortLink("undo001")).toBe("unavailable");
    // While deleted, the slug is still the code's: another code can't take it.
    const other = await make("Meanwhile");
    const gen = sequence("undo001", "undo002");
    expect(await activateDynamicCode(db, owner.id, other, gen)).toEqual({ ok: true, shortCode: "undo002" });

    expect(await restoreQrCodes(db, owner.id, [id])).toEqual([id]);
    expect(await shortLink("undo001")).toBe(A);
    expect(await activateDynamicCode(db, owner.id, id, () => "undo003")).toEqual({ ok: true, shortCode: "undo001" });
    expect(await changeFresh(db, owner.id, id, B)).toMatchObject({ ok: true, data: { destination: B } });
    expect((await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) }))?.shortCode).toBe("undo001");
    expect(await shortLink("undo001")).toBe(B);
    expect(await reserved("undo003")).toEqual([]);
  });

  it("concurrent assignment: one code gets a contested slug, the others retry to distinct ones", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => make(`Herd ${i}`)));
    const slugs = await Promise.all(ids.map((id, i) => assignShortCode(db, id, sequence("herd000", `herd00${i + 1}`))));
    expect(slugs.filter((s) => s === "herd000")).toHaveLength(1);
    expect(new Set(slugs).size).toBe(ids.length);
  });

  it("a contested slug waits for the holder: released if its activation rolls back, a collision if it commits", async () => {
    const watcher = await pool.connect();
    const contest = async (slug: string, fallback: string, outcome: "rollback" | "commit") => {
      const [x, y] = [await make(`Holder ${slug}`, racer.id), await make(`Waiter ${slug}`, racer.id)];
      const holder = await pool.connect();
      try {
        let finish = () => {};
        const gate = new Promise<void>((done) => (finish = done));
        let assigned = () => {};
        const ready = new Promise<void>((done) => (assigned = done));
        const activation = drizzle(holder, { schema, casing: "snake_case" }).transaction(async (tx) => {
          await assignShortCode(tx, x, () => slug);
          assigned();
          await gate;
          if (outcome === "rollback") throw new Error("activation failed");
        });
        await ready;
        const waiter = assignShortCode(db, y, sequence(slug, fallback));
        expect(await blockedOnLock(watcher)).toBe(true);
        finish();
        if (outcome === "rollback") await expect(activation).rejects.toThrow("activation failed");
        else await activation;
        return { waiter: await waiter, holder: (await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, x) }))?.shortCode };
      } finally {
        holder.release();
      }
    };
    try {
      // The failed activation never issued the slug, so it is free: the waiting code gets it.
      expect(await contest("race001", "race002", "rollback")).toEqual({ waiter: "race001", holder: null });
      expect(await reserved("race002")).toEqual([]);
      expect(await contest("race003", "race004", "commit")).toEqual({ waiter: "race004", holder: "race003" });
    } finally {
      watcher.release();
    }
  });

  it("the registry is append-only", async () => {
    for (const sql of [
      "delete from short_code_reservation where short_code = 'gone001'",
      "update short_code_reservation set short_code = 'gone00x' where short_code = 'gone001'",
      "truncate short_code_reservation",
    ])
      await expect(pool.query(sql)).rejects.toMatchObject({ code: "23000" });
    expect(await reserved("gone001")).toEqual([{ short_code: "gone001" }]);
  });
});

/*
 * HEY-127 / QR-17.05: the owner pauses and resumes a Dynamic code. Pause frees a plan slot and keeps everything;
 * Resume turns the same slug back on, to the current destination, under the plan or trial rules and a free slot.
 */
describe.skipIf(!url)("pause and resume (HEY-127, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "pause-owner", name: "Owner", email: "owner@pause.test", stripeCustomerId: "cus_pause_owner" };
  const other = { id: "pause-other", name: "Other", email: "other@pause.test" };
  const tester = { id: "pause-trial", name: "Trial", email: "trial@pause.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const A = "https://menu.example.test/a";
  const B = "https://menu.example.test/b";
  const STARTER_SLOTS = 5;
  const make = async (name: string, userId = owner.id) => {
    const saved = await saveQrWithLayouts(db, userId, {
      name,
      model: "dynamic",
      content: { type: "website", url: A },
      destination: A,
      layouts,
    });
    if (!saved.ok) throw new Error("save failed");
    return saved.data.qrCodeId;
  };
  const live = async (slug: string, userId = owner.id) => {
    const id = await make(`Code ${slug}`, userId);
    expect(await activateDynamicCode(db, userId, id, () => slug)).toEqual({ ok: true, shortCode: slug });
    return id;
  };
  const code = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id), with: { layouts: true } });
  /** What /r/<slug> answers (src/app/r/[code]/route.ts: the same lookup and checks, for non-trial codes). */
  const shortLink = async (slug: string) => {
    const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.shortCode, slug) });
    return !qr || qr.deletedAt || qr.status !== "active" || !qr.destination ? "unavailable" : qr.destination;
  };
  const slotsUsed = async (userId = owner.id) => (await accountUsage(db, userId)).dynamic.used;
  /** Frees the owner's slots for the next test: every live code of the owner is deleted. */
  const clearSlots = () =>
    db
      .update(schema.qrCode)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.qrCode.userId, owner.id), isNull(schema.qrCode.deletedAt)));

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other, tester]).onConflictDoNothing();
    await db.insert(schema.subscription).values(
      [owner, other].map((u) => ({
        id: `${u.id}-sub`,
        userId: u.id,
        stripeSubscriptionId: `sub_${u.id}`,
        stripePriceId: "price_x",
        status: "active" as const,
        plan: "starter" as const,
        activeCodeLimit: STARTER_SLOTS,
        currentPeriodStart: new Date(),
      })),
    );
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id, tester.id]));
    await pool?.end();
  });

  it("pause stops the link and frees the slot; a destination change while paused stays dark; resume opens it on the same slug", async () => {
    const id = await live("pz00001");
    const before = await code(id);
    expect([await shortLink("pz00001"), await slotsUsed()]).toEqual([A, 1]);

    expect(await pauseDynamicCode(db, owner.id, id)).toEqual({ ok: true });
    expect([(await code(id))?.status, await shortLink("pz00001"), await slotsUsed()]).toEqual(["paused", "unavailable", 0]);
    // Pausing again changes nothing.
    expect(await pauseDynamicCode(db, owner.id, id)).toEqual({ ok: true });

    expect(await changeFresh(db, owner.id, id, B)).toMatchObject({ ok: true, data: { destination: B, previousDestination: A } });
    expect([(await code(id))?.status, await shortLink("pz00001")]).toEqual(["paused", "unavailable"]);

    expect(await resumeDynamicCode(db, owner.id, id)).toEqual({ ok: true, shortCode: "pz00001" });
    const after = await code(id);
    expect([after?.status, after?.shortCode, after?.destination, await shortLink("pz00001"), await slotsUsed()]).toEqual([
      "active",
      "pz00001",
      B,
      B,
      1,
    ]);
    // Layouts, the destination history and the slug's reservation are kept.
    expect(after?.layouts.map((l) => [l.id, l.design])).toEqual(before?.layouts.map((l) => [l.id, l.design]));
    expect((await destinationHistory(db, owner.id, id)).map((h) => [h.previousUrl, h.newUrl])).toEqual([[A, B]]);
    expect((await pool.query("select 1 from short_code_reservation where short_code = 'pz00001'")).rowCount).toBe(1);
    // Resuming a live code changes nothing.
    expect(await resumeDynamicCode(db, owner.id, id)).toEqual({ ok: true, shortCode: "pz00001" });
    await clearSlots();
  });

  it("with every slot taken, resume is refused and the code stays paused; a freed slot lets it resume", async () => {
    const ids = [];
    for (let i = 0; i < STARTER_SLOTS; i++) ids.push(await live(`pzfull${i}`));
    const [first, second] = ids as [string, string];
    expect(await pauseDynamicCode(db, owner.id, first)).toEqual({ ok: true });
    // The freed slot is taken by another code.
    await live("pzfull9");
    expect(await slotsUsed()).toBe(STARTER_SLOTS);
    expect(await resumeDynamicCode(db, owner.id, first)).toEqual({ ok: false, error: "limit" });
    expect([(await code(first))?.status, await shortLink("pzfull0")]).toEqual(["paused", "unavailable"]);
    // Pausing another code frees one: now it resumes.
    expect(await pauseDynamicCode(db, owner.id, second)).toEqual({ ok: true });
    expect(await resumeDynamicCode(db, owner.id, first)).toEqual({ ok: true, shortCode: "pzfull0" });
    expect([await slotsUsed(), await shortLink("pzfull0"), await shortLink("pzfull1")]).toEqual([STARTER_SLOTS, A, "unavailable"]);
    await clearSlots();
  });

  it("three paused codes resuming at once for the last free slot: exactly one goes live", async () => {
    const ids = [];
    for (let i = 0; i < STARTER_SLOTS; i++) ids.push(await live(`pzrace${i}`));
    const [x, y] = ids as [string, string];
    await pauseDynamicCode(db, owner.id, x);
    await pauseDynamicCode(db, owner.id, y);
    expect(await slotsUsed()).toBe(STARTER_SLOTS - 2);
    // One slot left: take it with a third resume racing the other two.
    const z = ids[2] as string;
    await pauseDynamicCode(db, owner.id, z);
    await live("pzrace9");
    await live("pzrace8");
    expect(await slotsUsed()).toBe(STARTER_SLOTS - 1);
    const results = await Promise.all([
      resumeDynamicCode(db, owner.id, x),
      resumeDynamicCode(db, owner.id, y),
      resumeDynamicCode(db, owner.id, z),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "limit" },
      { ok: false, error: "limit" },
    ]);
    expect(await slotsUsed()).toBe(STARTER_SLOTS);
    await clearSlots();
  });

  it("only the owner can pause or resume; another account changes nothing", async () => {
    const id = await live("pzown01");
    expect(await pauseDynamicCode(db, other.id, id)).toEqual({ ok: false, error: "not_found" });
    expect([(await code(id))?.status, await shortLink("pzown01")]).toEqual(["active", A]);
    await pauseDynamicCode(db, owner.id, id);
    expect(await resumeDynamicCode(db, other.id, id)).toEqual({ ok: false, error: "not_found" });
    expect([(await code(id))?.status, await slotsUsed(other.id)]).toEqual(["paused", 0]);
    await clearSlots();
  });

  it("refuses invalid transitions: a draft, a static code, a deleted code, or resume without a plan", async () => {
    const draft = await make("Draft");
    expect(await pauseDynamicCode(db, owner.id, draft)).toEqual({ ok: false, error: "not_live" });
    expect(await resumeDynamicCode(db, owner.id, draft)).toEqual({ ok: false, error: "not_paused" });
    expect((await code(draft))?.status).toBe("draft");

    const savedStatic = await saveQrWithLayouts(db, owner.id, {
      name: "Static",
      model: "static",
      content: { type: "website", url: A },
      layouts,
    });
    if (!savedStatic.ok) throw new Error("save failed");
    expect(await pauseDynamicCode(db, owner.id, savedStatic.data.qrCodeId)).toEqual({ ok: false, error: "not_dynamic" });

    const gone = await live("pzgone1");
    await softDeleteQrCodes(db, owner.id, [gone]);
    expect(await pauseDynamicCode(db, owner.id, gone)).toEqual({ ok: false, error: "not_found" });

    const id = await live("pzplan1");
    await pauseDynamicCode(db, owner.id, id);
    await db.update(schema.subscription).set({ status: "canceled" }).where(eq(schema.subscription.userId, owner.id));
    try {
      expect(await resumeDynamicCode(db, owner.id, id)).toEqual({ ok: false, error: "no_plan" });
      expect([(await code(id))?.status, await shortLink("pzplan1")]).toEqual(["paused", "unavailable"]);
    } finally {
      await db.update(schema.subscription).set({ status: "active" }).where(eq(schema.subscription.userId, owner.id));
    }
    await clearSlots();
  });

  it("the trial's test code pauses and resumes while the trial runs; after it, resume needs the plan", async () => {
    const day1 = new Date();
    expect((await startTrial(db, tester.id, false, day1)).ok).toBe(true);
    const id = await make("Trial code", tester.id);
    expect(await activateTrialCode(db, tester.id, id, () => "pztrl01", day1)).toEqual({ ok: true, shortCode: "pztrl01" });
    expect(await pauseDynamicCode(db, tester.id, id)).toEqual({ ok: true });
    expect(await resumeDynamicCode(db, tester.id, id, day1)).toEqual({ ok: true, shortCode: "pztrl01" });
    expect(await pauseDynamicCode(db, tester.id, id)).toEqual({ ok: true });
    const ended = new Date(day1.getTime() + 8 * 86_400_000);
    expect(await resumeDynamicCode(db, tester.id, id, ended)).toEqual({ ok: false, error: "no_plan" });
    expect((await code(id))?.status).toBe("paused");
  });

  it("a delayed subscription Checkout event for a paused code keeps it paused", async () => {
    const id = await live("pzhook1");
    await pauseDynamicCode(db, owner.id, id);
    const event = {
      id: "evt_pause_delayed",
      type: "checkout.session.completed",
      session: {
        id: "cs_pause_delayed",
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        payment_intent: null,
        amount_subtotal: 900,
        amount_total: 900,
        total_details: null,
        currency: "usd",
        customer: owner.stripeCustomerId,
        metadata: { userId: owner.id, qrCodeId: id },
      } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
    };
    expect(await processCheckoutEvent(db, event, () => "pzhook9")).toEqual({ duplicate: false, result: { granted: true } });
    const row = await code(id);
    expect([row?.status, row?.shortCode, await shortLink("pzhook1"), await slotsUsed()]).toEqual(["paused", "pzhook1", "unavailable", 0]);
    expect(await resumeDynamicCode(db, owner.id, id)).toEqual({ ok: true, shortCode: "pzhook1" });
    await clearSlots();
  });
});

/*
 * HEY-128 / QR-17.06: concurrent Change destination edits. Each save names the destination revision its edit was opened
 * with; under the row lock, an older one is a conflict that writes nothing and returns the latest state.
 */
describe.skipIf(!url)("destination revisions (HEY-128, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "rev-owner", name: "Owner", email: "owner@rev.test" };
  const other = { id: "rev-other", name: "Other", email: "other@rev.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const A = "https://a.example.test/";
  const B = "https://b.example.test/";
  const C = "https://c.example.test/";
  const live = async (slug: string) => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: `Menu ${slug}`,
      model: "dynamic",
      content: { type: "website", url: A },
      layouts,
    });
    if (!saved.ok) throw new Error("save failed");
    await db.update(schema.qrCode).set({ shortCode: slug, status: "active" }).where(eq(schema.qrCode.id, saved.data.qrCodeId));
    return saved.data;
  };
  /** Everything a conflict or a no-op must leave as it was. */
  const snapshot = async (qrCodeId: string) => {
    const r = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, qrCodeId) });
    return {
      destination: r?.destination,
      previousDestination: r?.previousDestination,
      changedAt: r?.destinationChangedAt?.toISOString() ?? null,
      revision: r?.destinationRevision,
      shortCode: r?.shortCode,
      history: await destinationHistory(db, owner.id, qrCodeId),
    };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("existing codes start at revision 0 (the migration's default); each actual change advances it by one", async () => {
    await pool.query(
      `insert into qr_code (id, user_id, name, content, model, status, destination) values ('rev-legacy', $1, 'Legacy', '{}', 'dynamic', 'active', $2)`,
      [owner.id, A],
    );
    expect((await snapshot("rev-legacy")).revision).toBe(0);
    expect(await changeDestination(db, owner.id, "rev-legacy", B, 0)).toMatchObject({ ok: true, data: { destination: B, revision: 1 } });
    expect(await changeDestination(db, owner.id, "rev-legacy", C, 1)).toMatchObject({ ok: true, data: { destination: C, revision: 2 } });
  });

  it("two saves from the same revision at once: one change, one conflict with the winner's state, one history entry", async () => {
    for (let round = 0; round < 5; round++) {
      const { qrCodeId } = await live(`revrc0${round}`);
      const results = await Promise.all([changeDestination(db, owner.id, qrCodeId, B, 0), changeDestination(db, owner.id, qrCodeId, C, 0)]);
      const won = results.filter((r) => r.ok);
      const lost = results.filter((r) => !r.ok);
      expect([won.length, lost.length]).toEqual([1, 1]);
      const after = await snapshot(qrCodeId);
      const winner = won[0]?.ok ? won[0].data : undefined;
      expect(lost[0]).toEqual({ ok: false, error: "conflict", latest: winner });
      expect([after.destination, after.revision, after.history.length]).toEqual([winner?.destination, 1, 1]);
      expect(after.history[0]).toMatchObject({ previousUrl: A, newUrl: winner?.destination });
    }
  });

  it("A → B → A: a tab opened at the first A stays stale, even for the URL that matches again", async () => {
    const { qrCodeId } = await live("revaba1");
    expect((await changeDestination(db, owner.id, qrCodeId, B, 0)).ok).toBe(true);
    expect(await changeDestination(db, owner.id, qrCodeId, A, 1)).toMatchObject({ ok: true, data: { destination: A, revision: 2 } });
    const before = await snapshot(qrCodeId);
    expect(before.history.map((h) => h.newUrl)).toEqual([A, B]);
    // The stale tab still holds revision 0: neither C nor the same A goes through.
    for (const typed of [C, A, "a.example.test/"]) {
      const latest = { destination: A, previousDestination: B, changedAt: before.changedAt, revision: 2 };
      expect(await changeDestination(db, owner.id, qrCodeId, typed, 0)).toEqual({ ok: false, error: "conflict", latest });
    }
    expect(await snapshot(qrCodeId)).toEqual(before);
    // After loading the latest revision, the explicit save goes through.
    expect(await changeDestination(db, owner.id, qrCodeId, C, 2)).toMatchObject({ ok: true, data: { destination: C, revision: 3 } });
    expect((await snapshot(qrCodeId)).history.map((h) => h.newUrl)).toEqual([C, A, B]);
  });

  it("a no-op (same URL), invalid input and another account leave revision, metadata and history as they were", async () => {
    const { qrCodeId } = await live("revnop1");
    expect((await changeDestination(db, owner.id, qrCodeId, B, 0)).ok).toBe(true);
    const before = await snapshot(qrCodeId);
    expect(await changeDestination(db, owner.id, qrCodeId, B, 1)).toMatchObject({ ok: true, data: { destination: B, revision: 1 } });
    expect(await changeDestination(db, owner.id, qrCodeId, "not a url", 1)).toMatchObject({ ok: false, error: "invalid" });
    // Ownership is checked first: another account learns nothing about the latest state, with any revision.
    for (const revision of [0, 1])
      expect(await changeDestination(db, other.id, qrCodeId, C, revision)).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot(qrCodeId)).toEqual(before);
  });

  it("saving a design doesn't advance the destination revision; a tab opened before it still saves", async () => {
    const { qrCodeId, layoutIds } = await live("revdsg1");
    const saved = await saveQrWithLayouts(db, owner.id, {
      qrCodeId,
      name: "Menu (edited)",
      model: "dynamic",
      content: { type: "website", url: A },
      destination: A,
      layouts: [{ id: layoutIds[0], ...layouts[0], editor: { ...designSettingsOf(DEFAULT_DESIGN), fg: "#1F5C45" } }],
    });
    expect(saved.ok).toBe(true);
    expect((await snapshot(qrCodeId)).revision).toBe(0);
    expect(await changeDestination(db, owner.id, qrCodeId, B, 0)).toMatchObject({ ok: true, data: { destination: B, revision: 1 } });
  });
});

/*
 * HEY-132 / QR-18.02: one Stripe Customer per account, created once and used everywhere; subscription events and
 * subscription Checkout are attributed by that stored Customer, with metadata.userId as a consistency check.
 */
describe.skipIf(!url)("Stripe Customer binding (HEY-132, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const first = { id: "cus-first", name: "First", email: "first@customer.test" };
  const bound = { id: "cus-bound", name: "Bound", email: "bound@customer.test", stripeCustomerId: "cus_existing_1" };
  const other = { id: "cus-other", name: "Other", email: "other@customer.test", stripeCustomerId: "cus_other_1" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];

  /** A Stripe stand-in that honours idempotency keys like Stripe: the same key returns the same Customer. */
  const fakeStripe = (delayMs = 0) => {
    const byKey = new Map<string, { id: string; params: CustomerCreate }>();
    const calls: { key: string; params: CustomerCreate }[] = [];
    let n = 0;
    const prefix = `cus_fake_${Math.random().toString(36).slice(2, 8)}`;
    const create = async (params: CustomerCreate, key: string) => {
      calls.push({ key, params });
      await new Promise((done) => setTimeout(done, delayMs));
      const known = byKey.get(key);
      if (known) {
        if (JSON.stringify(known.params) !== JSON.stringify(params)) throw new Error("idempotency_error: different parameters");
        return { id: known.id };
      }
      const customer = { id: `${prefix}_${++n}`, params };
      byKey.set(key, customer);
      return { id: customer.id };
    };
    return { create, calls, customers: () => byKey.size };
  };
  const subscriptionEvent = (over: Partial<SubscriptionEvent> & { id: string }): SubscriptionEvent =>
    ({
      customer: bound.stripeCustomerId,
      status: "active",
      cancel_at_period_end: false,
      metadata: { userId: bound.id, plan: "starter" },
      items: { data: [{ price: { id: "price_starter_test" }, current_period_start: 1_795_000_000, current_period_end: 1_797_600_000 }] },
      ...over,
    }) as SubscriptionEvent;
  const noPlanPrice = () => null;
  const subs = (userId: string) => db.query.subscription.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
  const slots = async (userId: string) => (await accountUsage(db, userId)).dynamic;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([first, bound, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [first.id, bound.id, other.id]));
    await pool?.end();
  });

  it("two simultaneous first Checkouts of one account create one Customer and both use it", async () => {
    const stripe = fakeStripe(50);
    const ids = await Promise.all(Array.from({ length: 4 }, () => bindStripeCustomer(db, first.id, stripe.create)));
    expect(new Set(ids).size).toBe(1);
    expect(stripe.customers()).toBe(1);
    // Under the account lock the later requests find the binding: Stripe is asked once, with the account's key.
    expect(stripe.calls).toEqual([
      { key: customerIdempotencyKey(first.id), params: { email: first.email, metadata: { userId: first.id } } },
    ]);
    expect(await storedCustomer(db, first.id)).toBe(ids[0]);
  });

  it("a retry after Stripe created the Customer but the binding didn't commit gets the same Customer", async () => {
    const account = { id: "cus-retry", name: "Retry", email: "retry@customer.test" };
    await db.insert(schema.user).values(account);
    try {
      const stripe = fakeStripe();
      // Stripe creates the Customer, then the response is lost: nothing is bound.
      const lost = (params: CustomerCreate, key: string) =>
        stripe.create(params, key).then(() => Promise.reject(new Error("connection reset")));
      await expect(bindStripeCustomer(db, account.id, lost)).rejects.toThrow("connection reset");
      expect(await storedCustomer(db, account.id)).toBeNull();
      const id = await bindStripeCustomer(db, account.id, stripe.create);
      expect([stripe.customers(), stripe.calls.map((c) => c.key), await storedCustomer(db, account.id)]).toEqual([
        1,
        [customerIdempotencyKey(account.id), customerIdempotencyKey(account.id)],
        id,
      ]);
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, account.id));
    }
  });

  it("an existing binding is reused and never replaced; Stripe isn't asked", async () => {
    const stripe = fakeStripe();
    expect(await bindStripeCustomer(db, bound.id, stripe.create)).toBe("cus_existing_1");
    expect(stripe.calls).toEqual([]);
    expect(await storedCustomer(db, bound.id)).toBe("cus_existing_1");
    // Another account can't take a bound Customer (stripe_customer_id is unique).
    await expect(db.update(schema.user).set({ stripeCustomerId: "cus_existing_1" }).where(eq(schema.user.id, first.id))).rejects.toThrow();
  });

  it("a subscription event is written for the account bound to its Customer, with 5 Dynamic slots on Starter", async () => {
    expect(await deliverSubscription(db, subscriptionEvent({ id: "sub_hey132_ok" }), noPlanPrice)).toMatchObject({
      applied: true,
      userId: bound.id,
    });
    expect(await slots(bound.id)).toEqual({ used: 0, limit: 5 });
    // Without metadata the stored Customer alone decides; an update keeps the same account.
    expect(
      await deliverSubscription(db, subscriptionEvent({ id: "sub_hey132_ok", metadata: {}, cancel_at_period_end: true }), noPlanPrice),
    ).toMatchObject({ applied: true, userId: bound.id });
    expect((await subs(bound.id)).map((r) => [r.stripeSubscriptionId, r.cancelAtPeriodEnd])).toEqual([["sub_hey132_ok", true]]);
  });

  it("a mismatched customer/account binding writes nothing and grants no access", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // The event's Customer is Bound's, but its metadata names Other.
      const mismatched = subscriptionEvent({ id: "sub_hey132_bad", metadata: { userId: other.id, plan: "studio" } });
      expect(await deliverSubscription(db, mismatched, noPlanPrice)).toEqual({ applied: false, reason: "account_mismatch" });
      // A Customer no account holds, and a subscription already stored for another account.
      expect(
        await deliverSubscription(
          db,
          subscriptionEvent({ id: "sub_hey132_x", customer: "cus_nobody", metadata: { userId: other.id } }),
          noPlanPrice,
        ),
      ).toEqual({ applied: false, reason: "unknown_customer" });
      expect(
        await deliverSubscription(
          db,
          subscriptionEvent({ id: "sub_hey132_ok", customer: other.stripeCustomerId, metadata: { userId: other.id } }),
          noPlanPrice,
        ),
      ).toEqual({ applied: false, reason: "subscription_owner_mismatch" });
      expect(await subs(other.id)).toEqual([]);
      expect(await slots(other.id)).toEqual({ used: 0, limit: 0 });
      expect((await subs(bound.id)).map((r) => r.stripeSubscriptionId)).toEqual(["sub_hey132_ok"]);

      // Subscription Checkout for Other's code, paid by Bound's Customer: no plan, no slug, the code stays a draft.
      const saved = await saveQrWithLayouts(db, other.id, {
        name: "Other's code",
        model: "dynamic",
        content: { type: "website", url: "https://other.example.test/" },
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      const session = (customer: string, id: string) =>
        ({
          id,
          mode: "subscription",
          status: "complete",
          payment_status: "paid",
          payment_intent: null,
          amount_subtotal: 900,
          amount_total: 900,
          total_details: null,
          currency: "usd",
          customer,
          metadata: { userId: other.id, qrCodeId: saved.data.qrCodeId },
        }) as unknown as Parameters<typeof processCheckoutEvent>[1]["session"];
      expect(
        await processCheckoutEvent(
          db,
          { id: "evt_hey132_bad", type: "checkout.session.completed", session: session(bound.stripeCustomerId, "cs_hey132_bad") },
          () => "hey132x",
        ),
      ).toEqual({ duplicate: false, result: { granted: false, reason: "account_mismatch" } });
      expect(
        await processCheckoutEvent(
          db,
          { id: "evt_hey132_unk", type: "checkout.session.completed", session: session("cus_nobody", "cs_hey132_unk") },
          () => "hey132y",
        ),
      ).toEqual({ duplicate: false, result: { granted: false, reason: "unknown_customer" } });
      const code = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, saved.data.qrCodeId) });
      expect([code?.status, code?.shortCode]).toEqual(["draft", null]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[billing\] subscription not applied: account_mismatch sub=…/));
      // Logs carry codes and id tails only, never the account ids or emails.
      for (const [line] of warn.mock.calls)
        for (const secret of [other.id, bound.id, other.email]) expect(String(line)).not.toContain(secret);

      // The same Checkout with Other's own Customer goes through.
      expect(
        await processCheckoutEvent(
          db,
          { id: "evt_hey132_ok", type: "checkout.session.completed", session: session(other.stripeCustomerId, "cs_hey132_ok") },
          () => "hey132z",
        ),
      ).toEqual({ duplicate: false, result: { granted: true } });
      expect((await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, saved.data.qrCodeId) }))?.shortCode).toBe("hey132z");
    } finally {
      warn.mockRestore();
    }
  });
});

/*
 * HEY-133 / QR-18.03: subscription Checkout. The plan's slots come from the webhook; the Checkout's code (the trial's
 * test code on an upgrade) goes live with its ID and short link only for its own account and within the plan's slots.
 */
describe.skipIf(!url)("subscription Checkout (HEY-133, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const starter = { id: "sc-starter", name: "Starter", email: "starter@sc.test", stripeCustomerId: "cus_sc_starter" };
  const studio = { id: "sc-studio", name: "Studio", email: "studio@sc.test", stripeCustomerId: "cus_sc_studio" };
  const upgrader = { id: "sc-upgrader", name: "Upgrader", email: "upgrader@sc.test", stripeCustomerId: "cus_sc_upgrader" };
  const stranger = { id: "sc-stranger", name: "Stranger", email: "stranger@sc.test", stripeCustomerId: "cus_sc_stranger" };
  const accounts = [starter, studio, upgrader, stranger];
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const A = "https://a.example.test/";
  const B = "https://b.example.test/";
  const make = async (userId: string, name: string) => {
    const saved = await saveQrWithLayouts(db, userId, { name, model: "dynamic", content: { type: "website", url: A }, layouts });
    if (!saved.ok) throw new Error("save failed");
    return saved.data.qrCodeId;
  };
  const subscribe = (
    account: { id: string; stripeCustomerId: string },
    plan: "starter" | "studio",
    status: "active" | "canceled" = "active",
  ) =>
    deliverSubscription(
      db,
      {
        id: `sub_${account.id}`,
        customer: account.stripeCustomerId,
        status,
        cancel_at_period_end: false,
        metadata: { userId: account.id, plan },
        items: { data: [{ price: { id: `price_${plan}` }, current_period_start: 1_795_000_000, current_period_end: 1_797_600_000 }] },
      } as unknown as SubscriptionEvent,
      () => null,
    );
  const paid = (
    account: { id: string; stripeCustomerId: string },
    qrCodeId: string,
    eventId: string,
    plan = "starter",
    type = "checkout.session.completed",
  ) => ({
    id: eventId,
    type,
    session: {
      id: `cs_${account.id}`,
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      payment_intent: null,
      amount_subtotal: 900,
      amount_total: 900,
      total_details: null,
      currency: "usd",
      customer: account.stripeCustomerId,
      metadata: { userId: account.id, qrCodeId, plan, kind: "code" },
    } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
  });
  const code = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });
  const codes = async (userId: string) => (await db.query.qrCode.findMany({ where: (q, { eq }) => eq(q.userId, userId) })).length;
  /** What /r/<slug> answers (src/app/r/[code]/route.ts), for a code that isn't the trial's. */
  const shortLink = async (slug: string) => {
    const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.shortCode, slug) });
    return !qr || qr.deletedAt || qr.status !== "active" || !qr.destination || qr.isTrial ? "unavailable" : qr.destination;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(accounts).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(
      inArray(
        schema.user.id,
        accounts.map((a) => a.id),
      ),
    );
    await pool?.end();
  });

  it("Starter: 5 live Dynamic codes after the webhook, the 6th refused; no plan before it", async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await make(starter.id, `S${i}`));
    expect(await activateDynamicCode(db, starter.id, ids[0] as string, () => "scst000")).toEqual({ ok: false, error: "no_plan" });
    expect(await subscribe(starter, "starter")).toMatchObject({ applied: true, userId: starter.id });
    for (let i = 0; i < 5; i++) expect((await activateDynamicCode(db, starter.id, ids[i] as string, () => `scst00${i}`)).ok).toBe(true);
    expect(await activateDynamicCode(db, starter.id, ids[5] as string, () => "scst005")).toEqual({ ok: false, error: "limit" });
    expect((await accountUsage(db, starter.id)).dynamic).toEqual({ used: 5, limit: 5 });
  });

  it("Studio: 25 live Dynamic codes, the 26th refused", async () => {
    expect(await subscribe(studio, "studio")).toMatchObject({ applied: true, userId: studio.id });
    const ids = [];
    for (let i = 0; i < 26; i++) {
      // Drafts are capped; each code goes live before the next is saved.
      const id = await make(studio.id, `P${i}`);
      ids.push(id);
      const r = await activateDynamicCode(db, studio.id, id, () => `scpr${String(i).padStart(3, "0")}`);
      expect(r.ok).toBe(i < 25);
      if (i === 25) expect(r).toEqual({ ok: false, error: "limit" });
    }
    expect((await accountUsage(db, studio.id)).dynamic).toEqual({ used: 25, limit: 25 });
  });

  it("expired trial → plan: the trial code goes live again with its ID and short link, to the current destination", async () => {
    const day1 = new Date(Date.now() - 10 * 86_400_000);
    expect((await startTrial(db, upgrader.id, false, day1)).ok).toBe(true);
    const id = await make(upgrader.id, "Trial menu");
    expect(await activateTrialCode(db, upgrader.id, id, () => "scup001", day1)).toEqual({ ok: true, shortCode: "scup001" });
    // After the trial: the owner changes the destination; the link stays inactive until the plan is bought.
    expect((await changeFresh(db, upgrader.id, id, B)).ok).toBe(true);
    const owner = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, upgrader.id) });
    expect(owner && trialCovers(trialPhase(owner, false), { isTrial: true })).toBe(false);
    const before = await codes(upgrader.id);
    // Paid: the webhook (subscription Checkout of that code) and the subscription itself.
    expect(await processCheckoutEvent(db, paid(upgrader, id, "evt_sc_up"), () => "scupXXX")).toEqual({
      duplicate: false,
      result: { granted: true },
    });
    expect(await subscribe(upgrader, "starter")).toMatchObject({ applied: true, userId: upgrader.id });
    const row = await code(id);
    expect([row?.id, row?.shortCode, row?.status, row?.isTrial, row?.destination]).toEqual([id, "scup001", "active", false, B]);
    expect(await shortLink("scup001")).toBe(B);
    expect([await codes(upgrader.id), (await accountUsage(db, upgrader.id)).dynamic]).toEqual([before, { used: 1, limit: 5 }]);
  });

  it("redelivery grants nothing more: the same event is a duplicate; the other completion event changes nothing", async () => {
    const id = (await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.shortCode, "scup001") }))?.id as string;
    const snapshot = async () => ({
      row: await code(id),
      codes: await codes(upgrader.id),
      subs: (await db.query.subscription.findMany({ where: (t, { eq }) => eq(t.userId, upgrader.id) })).length,
      usage: (await accountUsage(db, upgrader.id)).dynamic,
    });
    const before = await snapshot();
    expect(await processCheckoutEvent(db, paid(upgrader, id, "evt_sc_up"), () => "scupYYY")).toEqual({ duplicate: true });
    expect(
      (
        await processCheckoutEvent(
          db,
          paid(upgrader, id, "evt_sc_up_async", "starter", "checkout.session.async_payment_succeeded"),
          () => "scupZZZ",
        )
      ).duplicate,
    ).toBe(false);
    expect(await subscribe(upgrader, "starter")).toMatchObject({ applied: true, userId: upgrader.id });
    const after = await snapshot();
    expect({ ...after, row: { ...after.row, updatedAt: null } }).toEqual({ ...before, row: { ...before.row, updatedAt: null } });
  });

  it("another account's QR ID, or a deleted code, is never restored by a Checkout", async () => {
    const theirs = await make(stranger.id, "Not yours");
    await db
      .update(schema.qrCode)
      .set({ isTrial: true, shortCode: "scfor01", status: "active", destination: A })
      .where(eq(schema.qrCode.id, theirs));
    // Paid with the upgrader's own Customer, naming the stranger's code.
    expect(await processCheckoutEvent(db, paid(upgrader, theirs, "evt_sc_foreign"), () => "scfor99")).toEqual({
      duplicate: false,
      result: { granted: false },
    });
    const row = await code(theirs);
    expect([row?.userId, row?.isTrial, row?.shortCode]).toEqual([stranger.id, true, "scfor01"]);
    // A code its owner deleted stays deleted and isn't activated.
    const gone = await make(upgrader.id, "Deleted");
    await softDeleteQrCodes(db, upgrader.id, [gone]);
    expect(await processCheckoutEvent(db, paid(upgrader, gone, "evt_sc_gone"), () => "scgone1")).toEqual({
      duplicate: false,
      result: { granted: false },
    });
    expect([(await code(gone))?.status, (await code(gone))?.shortCode]).toEqual(["draft", null]);
  });

  it("a plan Checkout's code doesn't go live beyond the purchased plan's slots", async () => {
    // Five codes left live by an earlier plan that ended, then Starter bought again for a sixth.
    expect(await subscribe(starter, "starter", "canceled")).toMatchObject({ applied: true });
    const sixth = await make(starter.id, "Sixth");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await processCheckoutEvent(db, paid(starter, sixth, "evt_sc_full"), () => "scfull1")).toEqual({
        duplicate: false,
        result: { granted: false, reason: "slot_full" },
      });
    } finally {
      warn.mockRestore();
    }
    expect([(await code(sixth))?.status, (await code(sixth))?.shortCode]).toEqual(["draft", null]);
    // Studio has room for it.
    expect(await processCheckoutEvent(db, paid(starter, sixth, "evt_sc_room", "studio"), () => "scroom1")).toEqual({
      duplicate: false,
      result: { granted: true },
    });
    expect((await code(sixth))?.shortCode).toBe("scroom1");
  });
});

/*
 * HEY-134 / QR-18.04: subscription lifecycle events are claimed and applied in one transaction, and write the
 * subscription as Stripe has it now, so redelivery, duplicates and out-of-order delivery converge on Stripe's state.
 */
describe.skipIf(!url)("subscription status sync (HEY-134, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "sync-owner", name: "Owner", email: "owner@sync.test", stripeCustomerId: "cus_sync_owner" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const PRICES = { price_sync_starter: "starter", price_sync_studio: "studio" } as const;
  const catalog = (id: string | undefined) => (id && id in PRICES ? PRICES[id as keyof typeof PRICES] : null);
  /** Stripe as it is now, per subscription (what subscriptions.retrieve returns). */
  const stripeNow = new Map<string, SubscriptionEvent>();
  const sub = (id: string, over: Partial<SubscriptionEvent> & { price?: keyof typeof PRICES } = {}): SubscriptionEvent => {
    const { price = "price_sync_starter", ...rest } = over;
    return {
      id,
      customer: owner.stripeCustomerId,
      status: "active",
      cancel_at_period_end: false,
      metadata: { userId: owner.id },
      items: { data: [{ price: { id: price }, current_period_start: 1_795_000_000, current_period_end: 1_797_600_000 }] },
      ...rest,
    } as unknown as SubscriptionEvent;
  };
  const deliver = (eventId: string, payload: SubscriptionEvent, type = "customer.subscription.updated") =>
    applySubscriptionEvent(
      db,
      { id: eventId, type, subscription: payload },
      {
        planForPrice: catalog,
        current: async (id) => {
          const now = stripeNow.get(id);
          if (!now) throw new Error("stripe: no such subscription");
          return now;
        },
      },
    );
  const row = (id: string) => db.query.subscription.findFirst({ where: (t, { eq }) => eq(t.stripeSubscriptionId, id) });
  const claimed = async (eventId: string) => (await pool.query("select 1 from webhook_event where id = $1", [eventId])).rowCount;
  const access = async () => {
    const usage = await accountUsage(db, owner.id);
    return { plan: usage.plan?.id ?? null, limit: usage.dynamic.limit };
  };
  const endAll = () => db.update(schema.subscription).set({ status: "canceled" }).where(eq(schema.subscription.userId, owner.id));

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("stores Stripe's status, the catalog plan and its slots, the period and cancel-at-period-end; access follows the policy", async () => {
    stripeNow.set("sub_sync_1", sub("sub_sync_1"));
    expect(await deliver("evt_sync_1a", sub("sub_sync_1"), "customer.subscription.created")).toMatchObject({
      duplicate: false,
      outcome: { applied: true },
    });
    const stored = await row("sub_sync_1");
    expect([stored?.status, stored?.plan, stored?.activeCodeLimit, stored?.stripePriceId, stored?.cancelAtPeriodEnd]).toEqual([
      "active",
      "starter",
      5,
      "price_sync_starter",
      false,
    ]);
    expect([stored?.currentPeriodStart?.getTime(), stored?.currentPeriodEnd?.getTime()]).toEqual([1_795_000_000_000, 1_797_600_000_000]);
    expect(await access()).toEqual({ plan: "starter", limit: 5 });
    // The catalog decides the plan from the Price, not metadata.
    stripeNow.set("sub_sync_1", sub("sub_sync_1", { price: "price_sync_studio", metadata: { userId: owner.id, plan: "starter" } }));
    await deliver("evt_sync_1b", sub("sub_sync_1"));
    expect(await access()).toEqual({ plan: "studio", limit: 25 });
    // Scheduled cancellation keeps the plan until the end; past_due keeps it (existing policy); the end removes it.
    stripeNow.set("sub_sync_1", sub("sub_sync_1", { price: "price_sync_studio", cancel_at_period_end: true }));
    await deliver("evt_sync_1c", sub("sub_sync_1"));
    expect([(await row("sub_sync_1"))?.cancelAtPeriodEnd, await access()]).toEqual([true, { plan: "studio", limit: 25 }]);
    stripeNow.set("sub_sync_1", sub("sub_sync_1", { price: "price_sync_studio", status: "past_due" }));
    await deliver("evt_sync_1d", sub("sub_sync_1"));
    expect([(await row("sub_sync_1"))?.status, await access()]).toEqual(["past_due", { plan: "studio", limit: 25 }]);
    stripeNow.set("sub_sync_1", sub("sub_sync_1", { price: "price_sync_studio", status: "canceled" }));
    await deliver("evt_sync_1e", sub("sub_sync_1", { status: "canceled" }), "customer.subscription.deleted");
    expect([(await row("sub_sync_1"))?.status, await access()]).toEqual(["canceled", { plan: null, limit: 0 }]);
  });

  it("a failed write rolls the event claim back with it; the redelivery applies the event", async () => {
    stripeNow.set("sub_sync_2", sub("sub_sync_2"));
    await pool.query(`
      create function hey134_refuse() returns trigger language plpgsql as $$ begin raise exception 'write failed'; end $$;
      create trigger hey134_refuse before insert or update on subscription for each row execute function hey134_refuse();
    `);
    try {
      await expect(deliver("evt_sync_2", sub("sub_sync_2"), "customer.subscription.created")).rejects.toThrow();
    } finally {
      await pool.query("drop trigger hey134_refuse on subscription; drop function hey134_refuse();");
    }
    expect([await claimed("evt_sync_2"), await row("sub_sync_2")]).toEqual([0, undefined]);
    // Stripe unreachable while reconciling: the same, nothing claimed.
    stripeNow.delete("sub_sync_2");
    await expect(deliver("evt_sync_2", sub("sub_sync_2"), "customer.subscription.created")).rejects.toThrow("no such subscription");
    expect(await claimed("evt_sync_2")).toBe(0);
    stripeNow.set("sub_sync_2", sub("sub_sync_2"));
    expect(await deliver("evt_sync_2", sub("sub_sync_2"), "customer.subscription.created")).toMatchObject({
      duplicate: false,
      outcome: { applied: true },
    });
    expect([await claimed("evt_sync_2"), (await row("sub_sync_2"))?.status, await access()]).toEqual([
      1,
      "active",
      { plan: "starter", limit: 5 },
    ]);
    await endAll();
  });

  it("duplicate and concurrent delivery of one event apply it once; concurrent different events converge on Stripe's state", async () => {
    stripeNow.set("sub_sync_3", sub("sub_sync_3"));
    const results = await Promise.all(
      Array.from({ length: 4 }, () => deliver("evt_sync_3", sub("sub_sync_3"), "customer.subscription.created")),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await deliver("evt_sync_3", sub("sub_sync_3"))).toEqual({ duplicate: true });
    stripeNow.set("sub_sync_3", sub("sub_sync_3", { price: "price_sync_studio" }));
    const different = await Promise.all([
      deliver("evt_sync_3b", sub("sub_sync_3")),
      deliver("evt_sync_3c", sub("sub_sync_3", { price: "price_sync_studio" })),
    ]);
    expect(different.every((r) => !r.duplicate)).toBe(true);
    expect((await db.query.subscription.findMany({ where: (t, { eq }) => eq(t.stripeSubscriptionId, "sub_sync_3") })).length).toBe(1);
    expect(await access()).toEqual({ plan: "studio", limit: 25 });
    await endAll();
  });

  it("an older update delivered after the cancellation doesn't bring back the status or the slots", async () => {
    // Stripe: created, upgraded, then canceled. The webhook sees the cancellation first, then the older events.
    stripeNow.set("sub_sync_4", sub("sub_sync_4", { price: "price_sync_studio", status: "canceled" }));
    await deliver("evt_sync_4_del", sub("sub_sync_4", { price: "price_sync_studio", status: "canceled" }), "customer.subscription.deleted");
    await deliver("evt_sync_4_old_up", sub("sub_sync_4", { price: "price_sync_studio" }));
    await deliver("evt_sync_4_old_new", sub("sub_sync_4"), "customer.subscription.created");
    expect([(await row("sub_sync_4"))?.status, (await row("sub_sync_4"))?.plan, await access()]).toEqual([
      "canceled",
      "studio",
      { plan: null, limit: 0 },
    ]);
    // Even if a lagging read of Stripe still said "active", an ended subscription stays ended.
    stripeNow.set("sub_sync_4", sub("sub_sync_4", { price: "price_sync_studio" }));
    await deliver("evt_sync_4_lag", sub("sub_sync_4"));
    expect([(await row("sub_sync_4"))?.status, await access()]).toEqual(["canceled", { plan: null, limit: 0 }]);
    // An older update without a cancellation: the newer upgrade stays.
    stripeNow.set("sub_sync_5", sub("sub_sync_5", { price: "price_sync_studio" }));
    await deliver("evt_sync_5_new", sub("sub_sync_5", { price: "price_sync_studio" }));
    await deliver("evt_sync_5_old", sub("sub_sync_5"), "customer.subscription.created");
    expect(await access()).toEqual({ plan: "studio", limit: 25 });
    await endAll();
  });

  it("Checkout fulfillment after the subscription ended doesn't activate its code; before it, the code goes live", async () => {
    const make = async (name: string) => {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name,
        model: "dynamic",
        content: { type: "website", url: "https://a.example.test/" },
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      return saved.data.qrCodeId;
    };
    const completed = (eventId: string, subscriptionId: string, qrCodeId: string) => ({
      id: eventId,
      type: "checkout.session.completed",
      session: {
        id: `cs_${eventId}`,
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        payment_intent: null,
        amount_subtotal: 900,
        amount_total: 900,
        total_details: null,
        currency: "usd",
        customer: owner.stripeCustomerId,
        subscription: subscriptionId,
        metadata: { userId: owner.id, qrCodeId, plan: "starter" },
      } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Canceled and synchronized first; the completion arrives late.
      const late = await make("Late");
      stripeNow.set("sub_sync_6", sub("sub_sync_6", { status: "canceled" }));
      await deliver("evt_sync_6_del", sub("sub_sync_6", { status: "canceled" }), "customer.subscription.deleted");
      expect(await processCheckoutEvent(db, completed("evt_sync_6_paid", "sub_sync_6", late), () => "sync601")).toEqual({
        duplicate: false,
        result: { granted: false, reason: "subscription_ended" },
      });
      expect([(await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, late) }))?.shortCode]).toEqual([null]);
      // In the usual order (completion before the subscription events, or at once), the code goes live.
      const onTime = await make("On time");
      stripeNow.set("sub_sync_7", sub("sub_sync_7"));
      const [paid] = await Promise.all([
        processCheckoutEvent(db, completed("evt_sync_7_paid", "sub_sync_7", onTime), () => "sync701"),
        deliver("evt_sync_7_new", sub("sub_sync_7"), "customer.subscription.created"),
      ]);
      expect(paid).toEqual({ duplicate: false, result: { granted: true } });
      expect([(await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, onTime) }))?.status, await access()]).toEqual([
        "active",
        { plan: "starter", limit: 5 },
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

/*
 * HEY-135 / QR-18.05: every quota is checked and consumed inside its activation transaction, under the account lock
 * (account row first, then the code row), so concurrent requests for different codes can't both take the last one.
 * Each race below holds the account lock in a separate session until both requests are queued on it.
 */
describe.skipIf(!url)("quota checks inside activation transactions (HEY-135, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const starter = { id: "quota-starter", name: "Starter", email: "starter@quota.test", stripeCustomerId: "cus_quota_starter" };
  const studio = { id: "quota-studio", name: "Studio", email: "studio@quota.test", stripeCustomerId: "cus_quota_studio" };
  const periodStart = new Date(Date.now() - 86_400_000);
  let codeSeq = 0;
  /** A code inserted directly (fixtures beyond the draft limit), Dynamic or static. */
  const insertCode = async (userId: string, over: Partial<typeof schema.qrCode.$inferInsert> = {}) => {
    const id = `quota-code-${++codeSeq}`;
    await db.insert(schema.qrCode).values({
      id,
      userId,
      name: id,
      content: { type: "website", url: "https://a.example.test/" },
      model: "dynamic",
      destination: "https://a.example.test/",
      ...over,
    });
    return id;
  };
  let slugSeq = 0;
  /** A unique slug per fixture (an issued slug is reserved for good, HEY-126). */
  const slug = () => `qt${String(++slugSeq).padStart(5, "0")}`;
  const liveDynamic = async (userId: string, n: number) => {
    for (let i = 0; i < n; i++) await insertCode(userId, { status: "active", shortCode: slug() });
  };
  const code = (id: string) => db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, id) });
  const slots = async (userId: string) => (await accountUsage(db, userId)).dynamic;
  const uses = async (userId: string, kind: "static_unlock" | "print_pack") =>
    Number((await pool.query("select count(*)::int as n from allowance_use where user_id = $1 and kind = $2", [userId, kind])).rows[0].n);
  /** Clears the account's codes and allowance rows between tests (every test starts from its own state). */
  const reset = async (userId: string) => {
    await pool.query("delete from allowance_use where user_id = $1", [userId]);
    await pool.query("delete from credit_ledger where user_id = $1", [userId]);
    await pool.query("update qr_code set deleted_at = now() where user_id = $1 and deleted_at is null", [userId]);
  };
  /** Runs the requests concurrently: all are queued on the account lock before any of them can proceed. */
  const race = async <T extends unknown[]>(userId: string, requests: { [K in keyof T]: () => Promise<T[K]> }) => {
    const holder = await pool.connect();
    const watcher = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query(`select id from "user" where id = $1 for update`, [userId]);
      const running = (requests as (() => Promise<unknown>)[]).map((run) => run());
      for (let i = 0; i < 300; i++) {
        const { rows } = await watcher.query(
          "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'",
        );
        if (rows[0].n >= requests.length) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      await holder.query("commit");
      return (await Promise.all(running)) as T;
    } finally {
      holder.release();
      watcher.release();
    }
  };
  const subscriptionPaid = (account: typeof starter, qrCodeId: string, eventId: string) => ({
    id: eventId,
    type: "checkout.session.completed",
    session: {
      id: `cs_${eventId}`,
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      payment_intent: null,
      amount_subtotal: 900,
      amount_total: 900,
      total_details: null,
      currency: "usd",
      customer: account.stripeCustomerId,
      metadata: { userId: account.id, qrCodeId, plan: "starter" },
    } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 10 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([starter, studio]).onConflictDoNothing();
    await db.insert(schema.subscription).values(
      (
        [
          [starter, "starter"],
          [studio, "studio"],
        ] as const
      ).map(([u, plan]) => ({
        id: `${u.id}-sub`,
        userId: u.id,
        stripeSubscriptionId: `sub_${u.id}`,
        stripePriceId: `price_${plan}`,
        status: "active" as const,
        plan,
        activeCodeLimit: PLANS[plan].dyn,
        currentPeriodStart: periodStart,
      })),
    );
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [starter.id, studio.id]));
    await pool?.end();
  });

  it("slots count live Dynamic codes only: not drafts, paused, deleted or trial codes, nor static unlocks or Print Packs", async () => {
    await reset(starter.id);
    await liveDynamic(starter.id, 2);
    await insertCode(starter.id); // a draft
    await insertCode(starter.id, { status: "paused", shortCode: slug() });
    await insertCode(starter.id, { status: "active", shortCode: slug(), deletedAt: new Date() });
    await insertCode(starter.id, { status: "active", shortCode: slug(), isTrial: true });
    const unlocked = await insertCode(starter.id, { model: "static", status: "active", purchasedAt: new Date(), destination: null });
    await db
      .insert(schema.allowanceUse)
      .values({ id: newId(), userId: starter.id, kind: "static_unlock", qrCodeId: unlocked, periodStart });
    expect(await slots(starter.id)).toEqual({ used: 2, limit: 5 });
    expect((await accountUsage(db, studio.id)).dynamic.limit).toBe(25);
  });

  it("one slot left, two activations of different codes at once: one goes live, the other is unchanged", async () => {
    await reset(starter.id);
    await liveDynamic(starter.id, 4);
    const [x, y] = [await insertCode(starter.id), await insertCode(starter.id)];
    const results = await race(starter.id, [
      () => activateDynamicCode(db, starter.id, x, () => "qwin0x1"),
      () => activateDynamicCode(db, starter.id, y, () => "qwin0y1"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "limit" }]);
    const [won, lost] = results[0]?.ok ? [x, y] : [y, x];
    const loser = await code(lost);
    expect([loser?.status, loser?.shortCode]).toEqual(["draft", null]);
    expect(await slots(starter.id)).toEqual({ used: 5, limit: 5 });
    // Repeating the winner's activation keeps its short link and takes no slot.
    const issued = (await code(won))?.shortCode;
    expect(await activateDynamicCode(db, starter.id, won, () => "qrepeat")).toEqual({ ok: true, shortCode: issued });
    expect(await slots(starter.id)).toEqual({ used: 5, limit: 5 });
  });

  it("cross-path: Resume of a paused code against an activation, for the last slot", async () => {
    await reset(starter.id);
    await liveDynamic(starter.id, 4);
    const pausedSlug = slug();
    const paused = await insertCode(starter.id, { status: "paused", shortCode: pausedSlug });
    const draft = await insertCode(starter.id);
    const [resumed, activated] = await race(starter.id, [
      () => resumeDynamicCode(db, starter.id, paused),
      () => activateDynamicCode(db, starter.id, draft, () => "qdraft2"),
    ]);
    expect([resumed?.ok, activated?.ok].filter(Boolean)).toHaveLength(1);
    const [p, d] = [await code(paused), await code(draft)];
    if (resumed?.ok) expect([p?.status, d?.status, d?.shortCode]).toEqual(["active", "draft", null]);
    else expect([p?.status, p?.shortCode, d?.status]).toEqual(["paused", pausedSlug, "active"]);
    expect(await slots(starter.id)).toEqual({ used: 5, limit: 5 });
  });

  it("two Resumes for the last slot at once, over several rounds without a lock held for them: one each time", async () => {
    for (let round = 0; round < 10; round++) {
      await reset(starter.id);
      await liveDynamic(starter.id, 4);
      const [x, y] = [
        await insertCode(starter.id, { status: "paused", shortCode: slug() }),
        await insertCode(starter.id, { status: "paused", shortCode: slug() }),
      ];
      const results = await Promise.all([resumeDynamicCode(db, starter.id, x), resumeDynamicCode(db, starter.id, y)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect([(await code(x))?.status, (await code(y))?.status].sort()).toEqual(["active", "paused"]);
      expect(await slots(starter.id)).toEqual({ used: 5, limit: 5 });
    }
  });

  it("cross-path: subscription Checkout fulfillment against an activation, for the last slot", async () => {
    await reset(starter.id);
    await liveDynamic(starter.id, 4);
    const [bought, draft] = [await insertCode(starter.id), await insertCode(starter.id)];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const [paid, activated] = await race(starter.id, [
        () => processCheckoutEvent(db, subscriptionPaid(starter, bought, "evt_quota_paid"), () => "qpaid03"),
        () => activateDynamicCode(db, starter.id, draft, () => "qdraft3"),
      ]);
      const paidWon = paid && "result" in paid && paid.result.granted;
      expect([Boolean(paidWon), Boolean(activated && "ok" in activated && activated.ok)].filter(Boolean)).toHaveLength(1);
      const [b, d] = [await code(bought), await code(draft)];
      if (paidWon) expect([b?.status, d?.status, d?.shortCode]).toEqual(["active", "draft", null]);
      else
        expect([b?.status, b?.shortCode, d?.status, paid]).toEqual([
          "draft",
          null,
          "active",
          { duplicate: false, result: { granted: false, reason: "slot_full" } },
        ]);
    } finally {
      warn.mockRestore();
    }
    expect(await slots(starter.id)).toEqual({ used: 5, limit: 5 });
  });

  it("one monthly static unlock left, two codes at once: one unlocked, one deduction; Dynamic slots untouched", async () => {
    await reset(starter.id);
    await liveDynamic(starter.id, 3);
    for (let i = 0; i < PLANS.starter.unlocks - 1; i++) {
      const used = await insertCode(starter.id, { model: "static", status: "active", purchasedAt: new Date(), destination: null });
      await db.insert(schema.allowanceUse).values({ id: newId(), userId: starter.id, kind: "static_unlock", qrCodeId: used, periodStart });
    }
    const before = await slots(starter.id);
    const [a, b] = [
      await insertCode(starter.id, { model: "static", destination: null }),
      await insertCode(starter.id, { model: "static", destination: null }),
    ];
    const results = await race(starter.id, [() => unlockStatic(db, starter.id, a, "plan"), () => unlockStatic(db, starter.id, b, "plan")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "no_allowance" }]);
    const purchased = [(await code(a))?.purchasedAt, (await code(b))?.purchasedAt].filter(Boolean);
    expect([purchased.length, await uses(starter.id, "static_unlock"), await slots(starter.id)]).toEqual([
      1,
      PLANS.starter.unlocks,
      before,
    ]);
    // The same with the last static credit: one unlock, one −1 in the ledger, balance 0.
    await db.insert(schema.creditLedger).values({ id: newId(), userId: starter.id, delta: 1, reason: "pack3" });
    const [c, d] = [
      await insertCode(starter.id, { model: "static", destination: null }),
      await insertCode(starter.id, { model: "static", destination: null }),
    ];
    const credit = await race(starter.id, [
      () => unlockStatic(db, starter.id, c, "credit"),
      () => unlockStatic(db, starter.id, d, "credit"),
    ]);
    expect(credit.filter((r) => r.ok)).toHaveLength(1);
    const spent = Number(
      (await pool.query("select count(*)::int as n from credit_ledger where user_id = $1 and reason = 'unlock'", [starter.id])).rows[0].n,
    );
    expect([
      spent,
      await creditBalance(db, starter.id),
      [(await code(c))?.purchasedAt, (await code(d))?.purchasedAt].filter(Boolean).length,
    ]).toEqual([1, 0, 1]);
    expect(await slots(starter.id)).toEqual(before);
  });

  it("one included Print Pack left (Studio), two codes at once: one granted, one deduction; Dynamic slots untouched", async () => {
    await reset(studio.id);
    await liveDynamic(studio.id, 2);
    for (let i = 0; i < PLANS.studio.packs - 1; i++) {
      const used = await insertCode(studio.id, {
        status: "active",
        shortCode: slug(),
        printPackAt: new Date(),
      });
      await db.insert(schema.allowanceUse).values({ id: newId(), userId: studio.id, kind: "print_pack", qrCodeId: used, periodStart });
    }
    const [a, b] = [
      await insertCode(studio.id, { status: "active", shortCode: slug() }),
      await insertCode(studio.id, { status: "active", shortCode: slug() }),
    ];
    const before = await slots(studio.id);
    const results = await race(studio.id, [
      () => applyPrintPackAllowance(db, studio.id, a),
      () => applyPrintPackAllowance(db, studio.id, b),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "no_allowance" }]);
    const granted = [(await code(a))?.printPackAt, (await code(b))?.printPackAt].filter(Boolean);
    expect([granted.length, await uses(studio.id, "print_pack"), await slots(studio.id)]).toEqual([1, PLANS.studio.packs, before]);
  });

  it("scan monitoring thresholds are 10,000 (Starter) and 100,000 (Studio); a code at or above them still redirects", async () => {
    expect(SCAN_MONITOR_THRESHOLDS).toEqual({ starter: 10_000, studio: 100_000 });
    for (const [account, plan] of [
      [starter, "starter"],
      [studio, "studio"],
    ] as const) {
      const id = await insertCode(account.id, { status: "active", shortCode: `qscan${plan}` });
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await db.insert(schema.scanDaily).values([
        { qrCodeId: id, day: yesterday, count: SCAN_MONITOR_THRESHOLDS[plan] },
        { qrCodeId: id, day: today, count: 1 },
      ]);
      // What /r/<slug> reads: the code itself; scans never decide the redirect.
      const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.shortCode, `qscan${plan}`) });
      expect([qr?.status, qr?.deletedAt, qr?.destination]).toEqual(["active", null, "https://a.example.test/"]);
    }
  });
});

/*
 * HEY-138 / QR-19.01: the confirmed rules behind the owner-facing matrix (docs/LINK_AVAILABILITY.md). Which Stripe
 * statuses keep the plan, including a failed renewal (past_due) and its recovery, and what a static unlock keeps.
 */
describe.skipIf(!url)("plan access by subscription status (HEY-138, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "lapse-owner", name: "Owner", email: "owner@lapse.test" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    await db.insert(schema.subscription).values({
      id: "lapse-sub",
      userId: owner.id,
      stripeSubscriptionId: "sub_lapse",
      stripePriceId: "price_starter",
      status: "active",
      plan: "starter",
      activeCodeLimit: 5,
      currentPeriodStart: new Date(),
    });
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("active, trialing and past_due keep the plan; every other status ends it; recovery brings it back", async () => {
    const access = async (status: string) => {
      await db.update(schema.subscription).set({ status }).where(eq(schema.subscription.stripeSubscriptionId, "sub_lapse"));
      const usage = await accountUsage(db, owner.id);
      return { plan: usage.plan?.id ?? null, slots: usage.dynamic.limit };
    };
    for (const status of ["active", "trialing", "past_due"])
      expect([status, await access(status)]).toEqual([status, { plan: "starter", slots: 5 }]);
    for (const status of ["unpaid", "canceled", "incomplete", "incomplete_expired", "paused"])
      expect([status, await access(status)]).toEqual([status, { plan: null, slots: 0 }]);
    // A failed renewal recovered: past_due → active keeps the plan throughout.
    expect([await access("past_due"), await access("active")]).toEqual([
      { plan: "starter", slots: 5 },
      { plan: "starter", slots: 5 },
    ]);
  });

  it("a static code unlocked with the plan keeps its unlock after the plan ends", async () => {
    await db.update(schema.subscription).set({ status: "active" }).where(eq(schema.subscription.stripeSubscriptionId, "sub_lapse"));
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Card",
      model: "static",
      content: { type: "website", url: "https://card.example.test/" },
      layouts: [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }],
    });
    if (!saved.ok) throw new Error("save failed");
    expect(await unlockStatic(db, owner.id, saved.data.qrCodeId, "plan")).toEqual({ ok: true, via: "plan" });
    await db.update(schema.subscription).set({ status: "canceled" }).where(eq(schema.subscription.stripeSubscriptionId, "sub_lapse"));
    const qr = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, saved.data.qrCodeId) });
    // canDownload's static rule is purchasedAt alone (entitlements.test.ts); the unlock stays on the code.
    expect([qr?.model, qr?.purchasedAt instanceof Date, (await accountUsage(db, owner.id)).plan]).toEqual(["static", true, null]);
  });
});

/* HEY-139: the Customer Portal schedules a cancellation with cancel_at; the plan keeps going until then. */
describe.skipIf(!url)("Portal-scheduled cancellation (HEY-139, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "portal-owner", name: "Owner", email: "owner@portal.test", stripeCustomerId: "cus_portal_owner" };
  const periodEnd = 1_797_600_000;
  const sub = (over: Partial<SubscriptionEvent>): SubscriptionEvent =>
    ({
      id: "sub_portal",
      customer: owner.stripeCustomerId,
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { userId: owner.id },
      items: { data: [{ price: { id: "price_starter" }, current_period_start: 1_795_000_000, current_period_end: periodEnd }] },
      ...over,
    }) as unknown as SubscriptionEvent;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("cancel_at without cancel_at_period_end counts as scheduled, ends then, and keeps the plan until it does", async () => {
    await deliverSubscription(db, sub({}));
    expect((await accountUsage(db, owner.id)).plan).toMatchObject({ cancelAtPeriodEnd: false, endsAt: null });
    await deliverSubscription(db, sub({ cancel_at: periodEnd }));
    const row = await db.query.subscription.findFirst({ where: (t, { eq }) => eq(t.stripeSubscriptionId, "sub_portal") });
    expect([row?.status, row?.cancelAtPeriodEnd, row?.cancelAt?.getTime()]).toEqual(["active", true, periodEnd * 1000]);
    const usage = await accountUsage(db, owner.id);
    expect([usage.plan?.id, usage.plan?.endsAt?.getTime(), usage.dynamic.limit]).toEqual(["starter", periodEnd * 1000, 5]);
    // Undoing the cancellation in the Portal clears both.
    await deliverSubscription(db, sub({ cancel_at: null }));
    expect((await accountUsage(db, owner.id)).plan).toMatchObject({ cancelAtPeriodEnd: false, endsAt: null });
  });
});

/*
 * HEY-141 / QR-19.04: a failed renewal and its recovery, as the webhook sees it (HEY-134 reconciliation). The account
 * follows Stripe's current status and period; a Portal return or a payment method change grants nothing by itself.
 */
describe.skipIf(!url)("failed renewal and recovery (HEY-141, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "renew-owner", name: "Owner", email: "owner@renew.test", stripeCustomerId: "cus_renew_owner" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const P1 = 1_797_600_000; // first period end
  const P2 = 1_800_278_400; // the renewed period end
  let stripeNow: SubscriptionEvent;
  const sub = (status: string, periodEnd: number): SubscriptionEvent =>
    ({
      id: "sub_renew",
      customer: owner.stripeCustomerId,
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { userId: owner.id },
      items: { data: [{ price: { id: "price_starter" }, current_period_start: periodEnd - 2_678_400, current_period_end: periodEnd }] },
    }) as unknown as SubscriptionEvent;
  let n = 0;
  /** One delivery of an event (its own payload), applied with Stripe's current state. */
  const deliver = (payload: SubscriptionEvent) =>
    applySubscriptionEvent(
      db,
      { id: `evt_renew_${++n}`, type: "customer.subscription.updated", subscription: payload },
      {
        planForPrice: () => null,
        current: async () => stripeNow,
      },
    );
  const access = async () => {
    const usage = await accountUsage(db, owner.id);
    return {
      plan: usage.plan?.id ?? null,
      overdue: usage.plan?.overdue ?? null,
      periodEnd: usage.plan?.periodEnd?.getTime() ?? null,
      owed: (await overdueSubscription(db, owner.id))?.status ?? null,
    };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("past_due keeps the plan and is owed; unpaid ends it and is still owed; paying reconciles to Stripe's state", async () => {
    stripeNow = sub("active", P1);
    await deliver(stripeNow);
    // Codes in different states before the failure: live, paused by the owner, deleted, and a static unlock.
    const make = async (name: string, model: "dynamic" | "static" = "dynamic") => {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name,
        model,
        content: { type: "website", url: "https://menu.example.test/" },
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      return saved.data.qrCodeId;
    };
    const live = await make("Live");
    const paused = await make("Paused");
    const deleted = await make("Deleted");
    const card = await make("Card", "static");
    for (const [id, slug] of [
      [live, "rnlive1"],
      [paused, "rnpaus1"],
      [deleted, "rndele1"],
    ] as const)
      expect((await activateDynamicCode(db, owner.id, id, () => slug)).ok).toBe(true);
    await pauseDynamicCode(db, owner.id, paused);
    await softDeleteQrCodes(db, owner.id, [deleted]);
    expect((await unlockStatic(db, owner.id, card, "plan")).ok).toBe(true);
    const codes = async () =>
      (await db.query.qrCode.findMany({ where: (q, { eq }) => eq(q.userId, owner.id), orderBy: (q, { asc }) => asc(q.name) })).map((q) => [
        q.name,
        q.status,
        q.shortCode,
        q.deletedAt ? "deleted" : "-",
        q.purchasedAt ? "unlocked" : "-",
      ]);
    const before = await codes();

    // The renewal fails: past_due for the new period. The plan stays (HEY-138), the payment is owed.
    stripeNow = sub("past_due", P2);
    await deliver(stripeNow);
    expect(await access()).toEqual({ plan: "starter", overdue: true, periodEnd: P2 * 1000, owed: "past_due" });
    // A payment method update, a Portal return, another failed attempt: Stripe still says past_due; nothing changes.
    await deliver(sub("past_due", P2));
    expect(await access()).toEqual({ plan: "starter", overdue: true, periodEnd: P2 * 1000, owed: "past_due" });
    // Not recovered in time: unpaid. The plan ends; the invoice can still be paid.
    stripeNow = sub("unpaid", P2);
    await deliver(stripeNow);
    expect(await access()).toEqual({ plan: null, overdue: null, periodEnd: null, owed: "unpaid" });

    // Paid: Stripe reports active for the renewed period.
    stripeNow = sub("active", P2);
    await deliver(stripeNow);
    expect(await access()).toEqual({ plan: "starter", overdue: false, periodEnd: P2 * 1000, owed: null });
    // A late copy of the failure event can't bring the overdue state back: Stripe's current state wins.
    await deliver(sub("past_due", P2));
    await deliver(sub("unpaid", P2));
    expect(await access()).toEqual({ plan: "starter", overdue: false, periodEnd: P2 * 1000, owed: null });
    expect((await db.query.subscription.findMany({ where: (t, { eq }) => eq(t.userId, owner.id) })).length).toBe(1);
    // Codes as they were: the live code keeps its slug, the pause and the deletion stay, the static unlock stays.
    expect(await codes()).toEqual(before);
  });
});

/*
 * HEY-142 / QR-19.05: paid access ends at the published cutoff (hasPlanAccess): a scheduled cancellation's cancel_at,
 * else its period end, even before Stripe's final event arrives. A renewing subscription keeps access past its period
 * end; past_due keeps it (HEY-138); recovery restores it. Codes and static unlocks are never touched.
 */
describe.skipIf(!url)("access at the paid period's end (HEY-142, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "cutoff-owner", name: "Owner", email: "owner@cutoff.test", stripeCustomerId: "cus_cutoff_owner" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const cutoff = new Date("2026-12-24T10:00:00Z");
  const set = (values: Partial<typeof schema.subscription.$inferInsert>) =>
    db.update(schema.subscription).set(values).where(eq(schema.subscription.stripeSubscriptionId, "sub_cutoff"));
  const plan = async (now: Date) => (await accountUsage(db, owner.id, now)).plan?.id ?? null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    await db.insert(schema.subscription).values({
      id: "cutoff-sub",
      userId: owner.id,
      stripeSubscriptionId: "sub_cutoff",
      stripePriceId: "price_starter",
      status: "active",
      plan: "starter",
      activeCodeLimit: 5,
      currentPeriodStart: new Date("2026-11-24T10:00:00Z"),
      currentPeriodEnd: cutoff,
    });
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("the rule: before the cutoff yes, at it no; renewing past the period end yes; past_due yes, unpaid no", () => {
    const at = (ms: number) => new Date(cutoff.getTime() + ms);
    const sub = (over: Partial<AccessFields>): AccessFields => ({
      status: "active",
      cancelAtPeriodEnd: false,
      cancelAt: null,
      currentPeriodEnd: cutoff,
      ...over,
    });
    expect(hasPlanAccess(sub({ cancelAtPeriodEnd: true, cancelAt: cutoff }), at(-1))).toBe(true);
    expect(hasPlanAccess(sub({ cancelAtPeriodEnd: true, cancelAt: cutoff }), at(0))).toBe(false);
    // cancel_at_period_end without a cancel_at: the period end is the cutoff.
    expect([hasPlanAccess(sub({ cancelAtPeriodEnd: true }), at(-1)), hasPlanAccess(sub({ cancelAtPeriodEnd: true }), at(0))]).toEqual([
      true,
      false,
    ]);
    // Renewing: the period end passing (before the renewal event arrives) doesn't end access.
    expect(hasPlanAccess(sub({}), at(3_600_000))).toBe(true);
    expect([hasPlanAccess(sub({ status: "past_due" }), at(0)), hasPlanAccess(sub({ status: "unpaid" }), at(-1))]).toEqual([true, false]);
  });

  it("a scheduled cancellation: the plan up to the cutoff, none from it, even while the final webhook is delayed", async () => {
    await set({ status: "active", cancelAtPeriodEnd: true, cancelAt: cutoff });
    expect([await plan(new Date(cutoff.getTime() - 1)), await plan(cutoff)]).toEqual(["starter", null]);
    // The final event arrives: canceled. Still none.
    await set({ status: "canceled" });
    expect(await plan(new Date(cutoff.getTime() - 1))).toBeNull();
  });

  it("past the cutoff: no new activation; codes keep their slug, destination, pause and deletion; static unlocks stay", async () => {
    await set({ status: "active", cancelAtPeriodEnd: false, cancelAt: null });
    const make = async (name: string, model: "dynamic" | "static" = "dynamic") => {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name,
        model,
        content: { type: "website", url: "https://menu.example.test/" },
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      return saved.data.qrCodeId;
    };
    const [live, paused, gone, draft, card] = [
      await make("A live"),
      await make("B paused"),
      await make("C deleted"),
      await make("D draft"),
      await make("E card", "static"),
    ];
    for (const [id, slug] of [
      [live, "cutlive"],
      [paused, "cutpaus"],
      [gone, "cutgone"],
    ] as const)
      expect((await activateDynamicCode(db, owner.id, id, () => slug)).ok).toBe(true);
    await pauseDynamicCode(db, owner.id, paused);
    await softDeleteQrCodes(db, owner.id, [gone]);
    expect((await unlockStatic(db, owner.id, card, "plan")).ok).toBe(true);
    const snapshot = async () =>
      (await db.query.qrCode.findMany({ where: (q, { eq }) => eq(q.userId, owner.id), orderBy: (q, { asc }) => asc(q.name) })).map((q) => [
        q.name,
        q.status,
        q.shortCode,
        q.destination,
        Boolean(q.deletedAt),
        Boolean(q.purchasedAt),
      ]);
    const before = await snapshot();
    // The cutoff passes (a cancellation scheduled for one second ago; the final webhook not yet in).
    await set({ cancelAtPeriodEnd: true, cancelAt: new Date(Date.now() - 1000) });
    expect(await activateDynamicCode(db, owner.id, draft, () => "cutdraf")).toEqual({ ok: false, error: "no_plan" });
    expect(await resumeDynamicCode(db, owner.id, paused)).toEqual({ ok: false, error: "no_plan" });
    expect(await snapshot()).toEqual(before);
    // Recovery (the owner takes the plan again / the subscription is active again): the same codes, as they were.
    await set({ status: "active", cancelAtPeriodEnd: false, cancelAt: null });
    expect([(await accountUsage(db, owner.id)).plan?.id, await snapshot()]).toEqual(["starter", before]);
  });
});

/*
 * HEY-143 / QR-19.06: subscription transitions and out-of-order delivery, through the webhook's own functions
 * (applySubscriptionEvent, processCheckoutEvent) and the entry points' own decisions (currentPlan for Plan & billing,
 * canDownloadCode, resolveShortLink), against HEY-138's policy. Stripe's current state is set per step; events are
 * delivered in a controlled order, including late copies of earlier events.
 */
describe.skipIf(!url)("subscription transitions and out-of-order delivery (HEY-143, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "order-owner", name: "Owner", email: "owner@order.test", stripeCustomerId: "cus_order_owner" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const P1 = 1_797_600_000; // the first period end
  const P2 = 1_800_278_400; // the renewed period end, a month later
  const d1 = new Date(P1 * 1000).toISOString().slice(0, 10);
  const d2 = new Date(P2 * 1000).toISOString().slice(0, 10);
  const stripeNow = new Map<string, SubscriptionEvent>();
  const sub = (id: string, status: string, periodEnd: number, over: Partial<SubscriptionEvent> = {}): SubscriptionEvent =>
    ({
      id,
      customer: owner.stripeCustomerId,
      status,
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { userId: owner.id, plan: "starter" },
      items: { data: [{ price: { id: "price_starter" }, current_period_start: periodEnd - 2_678_400, current_period_end: periodEnd }] },
      ...over,
    }) as unknown as SubscriptionEvent;
  /** Stripe moves to `state`; its event is delivered later (or never) by `deliver`. */
  const stripe = (state: SubscriptionEvent) => void stripeNow.set(state.id, state);
  const deliver = (eventId: string, payload: SubscriptionEvent) =>
    applySubscriptionEvent(
      db,
      { id: eventId, type: "customer.subscription.updated", subscription: payload },
      {
        planForPrice: () => null,
        current: async (id) => {
          const s = stripeNow.get(id);
          if (!s) throw new Error("unknown subscription");
          return s;
        },
      },
    );
  const codes = { live: "", paused: "", deleted: "" };
  const slugs = { live: "ordlive", paused: "ordpaus", deleted: "orddele" };
  /** Everything an owner and a scanner would see. */
  const observe = async (subscriptionId = "sub_order_1") => {
    const row = await db.query.subscription.findFirst({ where: (t, { eq }) => eq(t.stripeSubscriptionId, subscriptionId) });
    const plan = await currentPlan(db, owner.id);
    const live = await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, codes.live) });
    const link = async (slug: string) => {
      const a = await resolveShortLink(db, slug);
      return a.kind === "redirect" ? a.to : a.kind === "hosted" ? `hosted v${a.page.version}` : a.inactive ? "inactive" : "unavailable";
    };
    return {
      stored: `${row?.status} ${row?.currentPeriodEnd?.toISOString().slice(0, 10)}${row?.cancelAtPeriodEnd ? " scheduled" : ""}`,
      billing: plan
        ? `${plan.id}${plan.overdue ? " overdue" : ""} ${plan.cancelAtPeriodEnd ? `ends ${plan.endsAt?.toISOString().slice(0, 10)}` : `renews ${plan.periodEnd?.toISOString().slice(0, 10)}`}`
        : "no plan",
      download: live ? await canDownloadCode(db, owner.id, live) : null,
      link: await link(slugs.live),
      paused: await link(slugs.paused),
      deleted: await link(slugs.deleted),
    };
  };
  const D1 = "https://menu.example.test/one";
  const D2 = "https://menu.example.test/two";

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    stripe(sub("sub_order_1", "active", P1));
    await deliver("evt_o_create", sub("sub_order_1", "active", P1));
    for (const k of ["live", "paused", "deleted"] as const) {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name: k,
        model: "dynamic",
        content: { type: "website", url: D1 },
        destination: D1,
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      codes[k] = saved.data.qrCodeId;
      expect((await activateDynamicCode(db, owner.id, codes[k], () => slugs[k])).ok).toBe(true);
    }
    await pauseDynamicCode(db, owner.id, codes.paused);
    await softDeleteQrCodes(db, owner.id, [codes.deleted]);
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("1. renewal succeeds; a late copy of the old period's event keeps the renewed period", async () => {
    expect(await observe()).toEqual({
      stored: `active ${d1}`,
      billing: `starter renews ${d1}`,
      download: true,
      link: D1,
      paused: "unavailable",
      deleted: "unavailable",
    });
    stripe(sub("sub_order_1", "active", P2));
    await deliver("evt_o_renewed", sub("sub_order_1", "active", P2));
    await deliver("evt_o_old_period", sub("sub_order_1", "active", P1)); // delayed
    expect(await observe()).toMatchObject({ stored: `active ${d2}`, billing: `starter renews ${d2}`, download: true, link: D1 });
  });

  it("1. renewal fails, goes unpaid, then recovers; late failure events leave it active with the recovered period", async () => {
    stripe(sub("sub_order_1", "past_due", P2));
    await deliver("evt_o_failed", sub("sub_order_1", "past_due", P2));
    // HEY-138: past_due keeps access.
    expect(await observe()).toMatchObject({
      stored: `past_due ${d2}`,
      billing: `starter overdue renews ${d2}`,
      download: true,
      link: D1,
    });
    stripe(sub("sub_order_1", "unpaid", P2));
    await deliver("evt_o_unpaid", sub("sub_order_1", "unpaid", P2));
    expect(await observe()).toMatchObject({
      stored: `unpaid ${d2}`,
      billing: "no plan",
      download: false,
      link: "inactive",
      paused: "unavailable",
      deleted: "unavailable",
    });
    // While access is off, the owner points the printed code somewhere else.
    expect((await changeFresh(db, owner.id, codes.live, D2)).ok).toBe(true);
    stripe(sub("sub_order_1", "active", P2));
    await deliver("evt_o_recovered", sub("sub_order_1", "active", P2));
    for (const [id, payload] of [
      ["evt_o_failed_late", "past_due"],
      ["evt_o_unpaid_late", "unpaid"],
    ] as const)
      await deliver(id, sub("sub_order_1", payload, P2)); // delayed
    expect(await observe()).toEqual({
      stored: `active ${d2}`,
      billing: `starter renews ${d2}`,
      download: true,
      link: D2,
      paused: "unavailable",
      deleted: "unavailable",
    });
  });

  it("2. cancellation scheduled, then withdrawn; a late scheduling event leaves the renewal date", async () => {
    stripe(sub("sub_order_1", "active", P2, { cancel_at: P2 }));
    await deliver("evt_o_scheduled", sub("sub_order_1", "active", P2, { cancel_at: P2 }));
    expect(await observe()).toMatchObject({
      stored: `active ${d2} scheduled`,
      billing: `starter ends ${d2}`,
      download: true,
      link: D2,
    });
    stripe(sub("sub_order_1", "active", P2));
    await deliver("evt_o_withdrawn", sub("sub_order_1", "active", P2));
    await deliver("evt_o_scheduled_late", sub("sub_order_1", "active", P2, { cancel_at: P2, cancel_at_period_end: true })); // delayed
    expect(await observe()).toMatchObject({ stored: `active ${d2}`, billing: `starter renews ${d2}`, download: true, link: D2 });
  });

  it("3. the subscription ends; a late active update or Checkout completion doesn't bring access back", async () => {
    stripe(sub("sub_order_1", "canceled", P2));
    await deliver("evt_o_ended", sub("sub_order_1", "canceled", P2));
    expect(await observe()).toEqual({
      stored: `canceled ${d2}`,
      billing: "no plan",
      download: false,
      link: "inactive",
      paused: "unavailable",
      deleted: "unavailable",
    });
    await deliver("evt_o_active_late", sub("sub_order_1", "active", P2)); // delayed
    const draft = await saveQrWithLayouts(db, owner.id, {
      name: "draft",
      model: "dynamic",
      content: { type: "website", url: D1 },
      layouts,
    });
    if (!draft.ok) throw new Error("save failed");
    const late = {
      id: "evt_o_checkout_late",
      type: "checkout.session.completed",
      session: {
        id: "cs_order_late",
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        payment_intent: null,
        amount_subtotal: 900,
        amount_total: 900,
        total_details: null,
        currency: "usd",
        customer: owner.stripeCustomerId,
        subscription: "sub_order_1",
        metadata: { userId: owner.id, qrCodeId: draft.data.qrCodeId, plan: "starter" },
      } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await processCheckoutEvent(db, late, () => "ordlate")).toEqual({
        duplicate: false,
        result: { granted: false, reason: "subscription_ended" },
      });
    } finally {
      warn.mockRestore();
    }
    expect((await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, draft.data.qrCodeId) }))?.shortCode).toBeNull();
    expect(await observe()).toEqual({
      stored: `canceled ${d2}`,
      billing: "no plan",
      download: false,
      link: "inactive",
      paused: "unavailable",
      deleted: "unavailable",
    });
  });

  it("3. a new subscription after the old one ended: a late event for the old one leaves the new plan and access", async () => {
    stripe(sub("sub_order_2", "active", P2));
    await deliver("evt_o2_create", sub("sub_order_2", "active", P2));
    expect(await observe("sub_order_2")).toMatchObject({
      stored: `active ${d2}`,
      billing: `starter renews ${d2}`,
      download: true,
      link: D2,
    });
    await deliver("evt_o_old_active_late", sub("sub_order_1", "active", P1)); // the old subscription, delayed
    await deliver("evt_o_old_ended_late", sub("sub_order_1", "canceled", P2)); // and its end, delayed again
    expect(await observe("sub_order_1")).toMatchObject({ stored: `canceled ${d2}` });
    expect(await observe("sub_order_2")).toEqual({
      stored: `active ${d2}`,
      billing: `starter renews ${d2}`,
      download: true,
      link: D2,
      paused: "unavailable",
      deleted: "unavailable",
    });
  });

  it("4. duplicates and overlapping distinct events (same timestamp) converge, with no repeated side effects", async () => {
    stripe(sub("sub_order_2", "past_due", P2));
    const same = sub("sub_order_2", "past_due", P2);
    // The same event four times at once, and two distinct events with the same timestamp at once.
    const dupes = await Promise.all(Array.from({ length: 4 }, () => deliver("evt_o2_dup", same)));
    expect(dupes.filter((r) => !r.duplicate)).toHaveLength(1);
    stripe(sub("sub_order_2", "active", P2));
    const distinct = await Promise.all([
      deliver("evt_o2_t_a", sub("sub_order_2", "past_due", P2)),
      deliver("evt_o2_t_b", sub("sub_order_2", "active", P2)),
    ]);
    expect(distinct.every((r) => !r.duplicate)).toBe(true);
    expect((await db.query.subscription.findMany({ where: (t, { eq }) => eq(t.userId, owner.id) })).length).toBe(2);
    expect(await observe("sub_order_2")).toEqual({
      stored: `active ${d2}`,
      billing: `starter renews ${d2}`,
      download: true,
      link: D2,
      paused: "unavailable",
      deleted: "unavailable",
    });
    // A Checkout completion delivered twice grants once: the second is a duplicate and the slug stays.
    const draft = await saveQrWithLayouts(db, owner.id, {
      name: "bought",
      model: "dynamic",
      content: { type: "website", url: D1 },
      layouts,
    });
    if (!draft.ok) throw new Error("save failed");
    const completed = {
      id: "evt_o2_checkout",
      type: "checkout.session.completed",
      session: {
        id: "cs_order_2",
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        payment_intent: null,
        amount_subtotal: 900,
        amount_total: 900,
        total_details: null,
        currency: "usd",
        customer: owner.stripeCustomerId,
        subscription: "sub_order_2",
        metadata: { userId: owner.id, qrCodeId: draft.data.qrCodeId, plan: "starter" },
      } as unknown as Parameters<typeof processCheckoutEvent>[1]["session"],
    };
    const both = await Promise.all([
      processCheckoutEvent(db, completed, () => "ordbuy1"),
      processCheckoutEvent(db, completed, () => "ordbuy2"),
    ]);
    expect(both.filter((r) => r.duplicate)).toHaveLength(1);
    // Either delivery may claim the event first: the code gets the winner's slug, the other delivery changes nothing.
    const winner = both.findIndex((r) => !r.duplicate) === 0 ? "ordbuy1" : "ordbuy2";
    const slug = async () => (await db.query.qrCode.findFirst({ where: (q, { eq }) => eq(q.id, draft.data.qrCodeId) }))?.shortCode;
    expect(await slug()).toBe(winner);
    // A third delivery later is a duplicate too, and the slug stays.
    expect(await processCheckoutEvent(db, completed, () => "ordbuy3")).toEqual({ duplicate: true });
    expect(await slug()).toBe(winner);
    expect((await accountUsage(db, owner.id)).dynamic.used).toBe(2);
  });
});

/*
 * HEY-145 / QR-20.01: the scan counter, as the short-link route uses it (resolveShortLink, then incrementScan for a
 * redirect only). Concurrent scans don't lose increments; unavailable codes count nothing.
 */
describe.skipIf(!url)("scan counting (HEY-145, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "scan-owner", name: "Owner", email: "owner@scan.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const codes = { live: "", paused: "" };
  const count = async (id: string, day: string) =>
    Number(
      (await pool.query("select coalesce(sum(count), 0)::int as n from scan_daily where qr_code_id = $1 and day = $2", [id, day])).rows[0]
        .n,
    );
  /** One anonymous request, decided and counted the way /r/[code] does. */
  const scan = async (slug: string, day: string) => {
    const answer = await resolveShortLink(db, slug);
    if (answer.kind === "redirect") await incrementScan(db, answer.qrCodeId, day);
    return answer;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 10 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    await db.insert(schema.subscription).values({
      id: "scan-sub",
      userId: owner.id,
      stripeSubscriptionId: "sub_scan",
      stripePriceId: "price_starter",
      status: "active",
      plan: "starter",
      activeCodeLimit: 5,
      currentPeriodStart: new Date(),
    });
    for (const k of ["live", "paused"] as const) {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name: k,
        model: "dynamic",
        content: { type: "website", url: "https://a.example.test/" },
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      codes[k] = saved.data.qrCodeId;
      expect((await activateDynamicCode(db, owner.id, codes[k], () => `scan${k.slice(0, 3)}1`)).ok).toBe(true);
    }
    await pauseDynamicCode(db, owner.id, codes.paused);
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("40 concurrent scans of a code, starting with the day's first: exactly 40, one row", async () => {
    const day = "2026-11-01";
    const answers = await Promise.all(Array.from({ length: 40 }, () => scan("scanliv1", day)));
    expect(answers.every((a) => a.kind === "redirect")).toBe(true);
    expect(await count(codes.live, day)).toBe(40);
    expect(
      Number(
        (await pool.query("select count(*)::int as n from scan_daily where qr_code_id = $1 and day = $2", [codes.live, day])).rows[0].n,
      ),
    ).toBe(1);
    // More the same day, then the next day on its own row.
    await Promise.all(Array.from({ length: 10 }, () => scan("scanliv1", day)));
    await scan("scanliv1", "2026-11-02");
    expect([await count(codes.live, day), await count(codes.live, "2026-11-02")]).toEqual([50, 1]);
  });

  it("unavailable codes count nothing: paused, unknown, and a live code whose owner lost paid access", async () => {
    const day = "2026-11-03";
    expect((await scan("scanpau1", day)).kind).toBe("unavailable");
    expect((await scan("nosuchcode", day)).kind).toBe("unavailable");
    await db.update(schema.subscription).set({ status: "canceled" }).where(eq(schema.subscription.stripeSubscriptionId, "sub_scan"));
    try {
      expect(await scan("scanliv1", day)).toEqual({ kind: "unavailable", inactive: true });
    } finally {
      await db.update(schema.subscription).set({ status: "active" }).where(eq(schema.subscription.stripeSubscriptionId, "sub_scan"));
    }
    expect([await count(codes.live, day), await count(codes.paused, day)]).toEqual([0, 0]);
  });
});

/* HEY-146: the owner-facing scan report reads only the signed-in owner's code, as counts per day. */
describe.skipIf(!url)("owner-scoped scan report (HEY-146, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "report-owner", name: "Owner", email: "owner@report.test" };
  const other = { id: "report-other", name: "Other", email: "other@report.test" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("the owner sees the code's daily counts; another account sees only zeros; rows hold no request data", async () => {
    const saved = await saveQrWithLayouts(db, owner.id, {
      name: "Report",
      model: "dynamic",
      content: { type: "website", url: "https://a.example.test/" },
      layouts: [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }],
    });
    if (!saved.ok) throw new Error("save failed");
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 3; i++) await incrementScan(db, saved.data.qrCodeId, today);
    const mine = await scansByDay(db, owner.id, saved.data.qrCodeId, 7);
    expect([mine.length, mine.at(-1)]).toEqual([7, { day: today, count: 3 }]);
    expect(Object.keys(mine[0] ?? {})).toEqual(["day", "count"]);
    expect((await scansByDay(db, other.id, saved.data.qrCodeId, 7)).every((d) => d.count === 0)).toBe(true);
    // The stored analytics: the code, the day and a number. No IP, user agent, cookie, referrer or destination.
    const columns = (
      await pool.query("select column_name from information_schema.columns where table_name = 'scan_daily' order by ordinal_position")
    ).rows.map((r) => r.column_name);
    expect(columns).toEqual(["qr_code_id", "day", "count"]);
  });
});

/* HEY-147 / QR-20.03: daily scan counters per QR and UTC day, and the owner's per-code series. */
describe.skipIf(!url)("daily scan counts per QR (HEY-147, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "daily-owner", name: "Owner", email: "owner@daily.test" };
  const other = { id: "daily-other", name: "Other", email: "other@daily.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const codes = { a: "", b: "" };
  const rows = async (id: string) =>
    (await pool.query("select day::text as day, count from scan_daily where qr_code_id = $1 order by day", [id])).rows.map((r) => [
      r.day,
      r.count,
    ]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
    for (const k of ["a", "b"] as const) {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name: k,
        model: "dynamic",
        content: { type: "website", url: "https://a.example.test/" },
        destination: "https://a.example.test/",
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      codes[k] = saved.data.qrCodeId;
    }
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("one counter per QR and UTC day: the last millisecond before midnight and midnight itself are separate days", async () => {
    const before = new Date("2026-11-30T23:59:59.999Z");
    const at = new Date("2026-12-01T00:00:00.000Z");
    for (const moment of [before, before, at, at, at]) await incrementScan(db, codes.a, utcDay(moment));
    await incrementScan(db, codes.b, utcDay(at)); // another QR, same day: its own counter
    expect(await rows(codes.a)).toEqual([
      ["2026-11-30", 2],
      ["2026-12-01", 3],
    ]);
    expect(await rows(codes.b)).toEqual([["2026-12-01", 1]]);
  });

  it("the owner's series: oldest first, days without scans at zero, other QRs apart; another account gets zeros", async () => {
    // "Now" is noon on Dec 2: four days back is Nov 29.
    const now = new Date("2026-12-02T12:00:00Z");
    expect(await scansByDay(db, owner.id, codes.a, 4, now)).toEqual([
      { day: "2026-11-29", count: 0 },
      { day: "2026-11-30", count: 2 },
      { day: "2026-12-01", count: 3 },
      { day: "2026-12-02", count: 0 },
    ]);
    expect((await scansByDay(db, owner.id, codes.b, 4, now)).map((d) => d.count)).toEqual([0, 0, 1, 0]);
    expect((await scansByDay(db, other.id, codes.a, 4, now)).every((d) => d.count === 0)).toBe(true);
    // A report built one millisecond before midnight ends on that day; one at midnight starts the next.
    expect((await scansByDay(db, owner.id, codes.a, 2, new Date("2026-11-30T23:59:59.999Z"))).map((d) => d.day)).toEqual([
      "2026-11-29",
      "2026-11-30",
    ]);
    expect((await scansByDay(db, owner.id, codes.a, 2, new Date("2026-12-01T00:00:00Z"))).map((d) => d.day)).toEqual([
      "2026-11-30",
      "2026-12-01",
    ]);
  });

  it("a destination change keeps the history under the same QR: later scans add to the same counters", async () => {
    await db.update(schema.qrCode).set({ shortCode: "dly0001", status: "active" }).where(eq(schema.qrCode.id, codes.a));
    expect((await changeFresh(db, owner.id, codes.a, "https://b.example.test/")).ok).toBe(true);
    await incrementScan(db, codes.a, "2026-12-01");
    expect(await rows(codes.a)).toEqual([
      ["2026-11-30", 2],
      ["2026-12-01", 4],
    ]);
  });
});

/* HEY-148 / QR-20.04: the period shown on QR details and the home summary (HEY-198) read the same counts the same way. */
describe.skipIf(!url)("scan period on QR details and the home summary (HEY-148, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "period-owner", name: "Owner", email: "owner@period.test" };
  const other = { id: "period-other", name: "Other", email: "other@period.test" };
  const layouts = [{ name: "Card", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const codes = { busy: "", old: "", fresh: "", gone: "" };
  // "Now" is 10:00 UTC on Dec 14: the 14-day window is Dec 1 – Dec 14.
  const now = new Date("2026-12-14T10:00:00Z");

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
    for (const k of ["busy", "old", "fresh", "gone"] as const) {
      const saved = await saveQrWithLayouts(db, owner.id, {
        name: k,
        model: "dynamic",
        content: { type: "website", url: "https://a.example.test/" },
        layouts,
      });
      if (!saved.ok) throw new Error("save failed");
      codes[k] = saved.data.qrCodeId;
    }
    const counts: [string, string, number][] = [
      [codes.busy, "2026-11-30", 7], // outside the window (the day before it)
      [codes.busy, "2026-12-01", 2], // the window's first day
      [codes.busy, "2026-12-07", 1],
      [codes.busy, "2026-12-14", 3], // today
      [codes.old, "2026-11-10", 5], // only earlier scans
      [codes.gone, "2026-12-14", 9], // a code deleted later
    ];
    for (const [id, day, n] of counts)
      await pool.query("insert into scan_daily (qr_code_id, day, count) values ($1, $2, $3)", [id, day, n]);
    await softDeleteQrCodes(db, owner.id, [codes.gone]);
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("QR details: 14 days ending today, oldest first, zeros kept; Total = their sum; Today = the last day", async () => {
    const days = await scansByDay(db, owner.id, codes.busy, 14, now);
    expect([days[0], days[6], days[13], days.length]).toEqual([
      { day: "2026-12-01", count: 2 },
      { day: "2026-12-07", count: 1 },
      { day: "2026-12-14", count: 3 },
      14,
    ]);
    expect(days.filter((d) => d.count === 0)).toHaveLength(11);
    expect([days.reduce((s, d) => s + d.count, 0), days.at(-1)?.count]).toEqual([6, 3]); // the 7 on Nov 30 is outside
  });

  it("the empty states: never scanned vs. scanned only before the period; owner-only", async () => {
    expect((await scansByDay(db, owner.id, codes.old, 14, now)).every((d) => d.count === 0)).toBe(true);
    expect([await hasScans(db, owner.id, codes.old), await hasScans(db, owner.id, codes.fresh)]).toEqual([true, false]);
    expect(await hasScans(db, other.id, codes.old)).toBe(false);
  });

  it("the home summary: the same window and today, the same per-code totals; deleted codes left out", async () => {
    const summary = await ownerScanSummary(db, owner.id, 14, now);
    expect([summary.scans[0], summary.scans.at(-1), summary.scans.reduce((s, d) => s + d.count, 0)]).toEqual([
      { day: "2026-12-01", count: 2 },
      { day: "2026-12-14", count: 3 },
      6,
    ]);
    expect(summary.scansByCode.get(codes.busy)).toEqual({ total: 6, today: 3 });
    expect([summary.scansByCode.has(codes.old), summary.scansByCode.has(codes.gone)]).toEqual([false, false]);
    // The same as QR details, day by day.
    expect(summary.scans).toEqual(await scansByDay(db, owner.id, codes.busy, 14, now));
    const others = await ownerScanSummary(db, other.id, 14, now);
    expect([others.scans.every((d) => d.count === 0), others.scansByCode.size]).toEqual([true, 0]);
  });

  it("a destination change keeps the history; the next scan adds to today", async () => {
    await db.update(schema.qrCode).set({ shortCode: "per0001", status: "active" }).where(eq(schema.qrCode.id, codes.busy));
    expect((await changeFresh(db, owner.id, codes.busy, "https://b.example.test/")).ok).toBe(true);
    await incrementScan(db, codes.busy, "2026-12-14");
    const days = await scansByDay(db, owner.id, codes.busy, 14, now);
    expect([days[0]?.count, days.at(-1)?.count, days.reduce((s, d) => s + d.count, 0)]).toEqual([2, 4, 7]);
  });
});

/* HEY-153 / QR-21.01: account API keys: one-way stored, listed as metadata, bound to their account. */
describe.skipIf(!url)("account API keys (HEY-153, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const alice = { id: "keys-alice", name: "Alice", email: "alice@keys.test" };
  const bob = { id: "keys-bob", name: "Bob", email: "bob@keys.test" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([alice, bob]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [alice.id, bob.id]));
    await pool?.end();
  });

  it("two keys for one account are distinct; nothing stored contains the key or its secret", async () => {
    const [k1, k2] = [await createApiKey(db, alice.id), await createApiKey(db, alice.id)];
    expect(k1.key).not.toBe(k2.key);
    expect(k1.prefix).not.toBe(k2.prefix);
    const stored = JSON.stringify((await pool.query("select * from api_key where user_id = $1", [alice.id])).rows);
    for (const k of [k1, k2]) {
      const secret = k.key.slice(k.prefix.length + 1);
      expect([stored.includes(k.key), stored.includes(secret)]).toEqual([false, false]);
    }
    // The management list: prefix and date only.
    const list = await listApiKeys(db, alice.id);
    expect(list.map((k) => Object.keys(k).sort())).toEqual([
      ["createdAt", "id", "lastUsedAt", "prefix", "revokedAt"],
      ["createdAt", "id", "lastUsedAt", "prefix", "revokedAt"],
    ]);
    expect(JSON.stringify(list).includes(k1.key.slice(k1.prefix.length + 1))).toBe(false);
    expect(new Set(list.map((k) => k.prefix))).toEqual(new Set([k1.prefix, k2.prefix]));
  });

  it("each key resolves to its own account only; a wrong or mixed key resolves to none", async () => {
    const a = await createApiKey(db, alice.id);
    const b = await createApiKey(db, bob.id);
    expect(await apiKeyOwner(db, a.key)).toBe(alice.id);
    expect(await apiKeyOwner(db, b.key)).toBe(bob.id);
    // Alice's lookup id with Bob's secret, a changed character, and garbage.
    const mixed = `${a.prefix}_${b.key.slice(b.prefix.length + 1)}`;
    const changed = `${a.key.slice(0, -1)}${a.key.endsWith("A") ? "B" : "A"}`;
    for (const bad of [mixed, changed, "hqk_nope", ""]) expect(await apiKeyOwner(db, bad)).toBeNull();
    // Bob's list never shows Alice's keys.
    expect((await listApiKeys(db, bob.id)).map((k) => k.prefix)).toEqual([b.prefix]);
  });

  it("deleting the account deletes its keys; its keys stop resolving", async () => {
    const carol = { id: "keys-carol", name: "Carol", email: "carol@keys.test" };
    await db.insert(schema.user).values(carol);
    const c = await createApiKey(db, carol.id);
    await db.delete(schema.user).where(eq(schema.user.id, carol.id));
    expect(await apiKeyOwner(db, c.key)).toBeNull();
    expect(Number((await pool.query("select count(*)::int as n from api_key where user_id = $1", [carol.id])).rows[0].n)).toBe(0);
  });
});

/* HEY-154 / QR-21.02: revocation and the shared verifier. */
describe.skipIf(!url)("API key revocation (HEY-154, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ann = { id: "revoke-ann", name: "Ann", email: "ann@revoke.test" };
  const ben = { id: "revoke-ben", name: "Ben", email: "ben@revoke.test" };
  const row = async (keyId: string) =>
    (await db.query.apiKey.findFirst({ where: (k, { eq }) => eq(k.id, keyId) })) as { revokedAt: Date | null; lastUsedAt: Date | null };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([ann, ben]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [ann.id, ben.id]));
    await pool?.end();
  });

  it("migration 0016 keeps a key issued before it valid", async () => {
    const migration = readFileSync(fileURLToPath(new URL("../../../drizzle/0016_api_key_revocation.sql", import.meta.url)), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      // The table as HEY-153 left it, with a key issued then.
      await client.query("alter table api_key drop column revoked_at, drop column last_used_at");
      const old = generateApiKey();
      await client.query("insert into api_key (id, user_id, lookup_id, secret_hash) values ('pre-0016', $1, $2, $3)", [
        ann.id,
        old.lookupId,
        old.secretHash,
      ]);
      for (const statement of migration.split("--> statement-breakpoint")) await client.query(statement);
      const inTx = drizzle(client, { schema, casing: "snake_case" });
      expect(await apiKeyOwner(inTx, old.key)).toBe(ann.id);
      expect(
        (await client.query("select revoked_at, last_used_at is not null as used from api_key where id = 'pre-0016'")).rows[0],
      ).toEqual({ revoked_at: null, used: true });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("before revocation the key authenticates; after it, the key is refused like an invalid one; other keys keep working", async () => {
    const [one, two] = [await createApiKey(db, ann.id), await createApiKey(db, ann.id)];
    expect([await apiKeyOwner(db, one.key), await apiKeyOwner(db, two.key)]).toEqual([ann.id, ann.id]);
    const revoked = await revokeApiKey(db, ann.id, one.id);
    expect(revoked?.revokedAt).toEqual(expect.any(String));
    // Refused: exactly what an unknown key gets.
    expect([await apiKeyOwner(db, one.key), await apiKeyOwner(db, "hqk_nope")]).toEqual([null, null]);
    expect(await apiKeyOwner(db, two.key)).toBe(ann.id);
    expect((await listApiKeys(db, ann.id)).find((k) => k.id === one.id)).toMatchObject({ revokedAt: revoked?.revokedAt });
  });

  it("only the owner can revoke; repeating keeps the original time", async () => {
    const key = await createApiKey(db, ann.id);
    expect(await revokeApiKey(db, ben.id, key.id)).toBeNull();
    expect([await apiKeyOwner(db, key.key), (await row(key.id)).revokedAt]).toEqual([ann.id, null]);
    const first = await revokeApiKey(db, ann.id, key.id);
    await new Promise((done) => setTimeout(done, 20));
    expect(await revokeApiKey(db, ann.id, key.id)).toEqual(first);
    expect((await row(key.id)).revokedAt?.toISOString()).toBe(first?.revokedAt);
    expect(await revokeApiKey(db, ann.id, "no-such-key")).toBeNull();
  });

  it("last use: set only by a successful authentication; failed and revoked attempts leave it", async () => {
    const key = await createApiKey(db, ben.id);
    expect((await row(key.id)).lastUsedAt).toBeNull();
    await apiKeyOwner(db, `${key.key.slice(0, -1)}${key.key.endsWith("A") ? "B" : "A"}`); // wrong secret
    expect((await row(key.id)).lastUsedAt).toBeNull();
    expect(await apiKeyOwner(db, key.key)).toBe(ben.id);
    const used = (await row(key.id)).lastUsedAt;
    expect(used).toBeInstanceOf(Date);
    await revokeApiKey(db, ben.id, key.id);
    await new Promise((done) => setTimeout(done, 20));
    expect(await apiKeyOwner(db, key.key)).toBeNull();
    expect((await row(key.id)).lastUsedAt).toEqual(used);
  });
});

/* HEY-155 / QR-21.03: POST /api/v1/qr-codes, through the route handler, the shared verifier and the editor's save path. */
describe.skipIf(!url)("public API: create a QR (HEY-155, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let POST: (request: Request) => Promise<Response>;
  let listQrCodes: (userId: string) => Promise<{ id: string }[]>;
  const owner = { id: "api-owner", name: "Owner", email: "owner@api.test" };
  const other = { id: "api-other", name: "Other", email: "other@api.test" };
  let ownerKey = "";
  let otherCode = { id: "", layoutId: "" };
  const design = { ...DEFAULT_DESIGN, fg: "#1F3A5F" };
  const layout = { name: "Sticker", layout: designToLayout(design), editor: designSettingsOf(design) };
  const valid = { name: "Menu", mode: "static", content: { type: "website", url: "littlefern.cafe/menu" }, layouts: [layout] };

  const call = (body: unknown, auth?: string | null) =>
    POST(
      new Request("http://localhost/api/v1/qr-codes", {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth ?? `Bearer ${ownerKey}` }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  const rows = async () => {
    const [codes, layouts] = await Promise.all([
      pool.query("select id, user_id, name, content, updated_at from qr_code where user_id in ($1, $2) order by id", [owner.id, other.id]),
      pool.query(
        "select l.id, l.qr_code_id, l.name from qr_layout l join qr_code q on q.id = l.qr_code_id where q.user_id in ($1, $2) order by l.id",
        [owner.id, other.id],
      ),
    ]);
    return JSON.stringify([codes.rows, layouts.rows]);
  };
  const clear = () => pool.query("delete from qr_code where user_id = $1", [owner.id]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    apiDb.current = db;
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
    ownerKey = (await createApiKey(db, owner.id)).key;
    const saved = await saveQrWithLayouts(db, other.id, {
      name: "Theirs",
      model: "static",
      content: { type: "text", text: "theirs" },
      layouts: [layout],
    });
    if (!saved.ok) throw new Error("fixture");
    otherCode = { id: saved.data.qrCodeId, layoutId: saved.data.layoutIds[0] ?? "" };
    ({ POST } = await import("../../app/api/v1/qr-codes/route"));
    ({ listQrCodes } = await import("../qr/repository"));
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("a valid key creates a draft for its owner, with its layouts, shown in the owner's dashboard", async () => {
    await clear();
    const res = await call({ ...valid, layouts: [layout, { ...layout, name: "Poster" }] });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { id: string; status: string; layouts: { id: string }[] };
    expect(body).toEqual({ id: expect.any(String), status: "draft", layouts: [{ id: expect.any(String) }, { id: expect.any(String) }] });
    const [code] = (
      await pool.query("select user_id, status, model, short_code, content, guest_claim_key from qr_code where id = $1", [body.id])
    ).rows;
    expect(code).toEqual({
      user_id: owner.id,
      status: "draft",
      model: "static",
      short_code: null,
      content: { type: "website", url: "https://littlefern.cafe/menu" },
      guest_claim_key: null,
    });
    const layouts = (await pool.query("select id, name from qr_layout where qr_code_id = $1 order by sort_order", [body.id])).rows;
    expect(layouts).toEqual([
      { id: body.layouts[0]?.id, name: "Sticker" },
      { id: body.layouts[1]?.id, name: "Poster" },
    ]);
    expect((await listQrCodes(owner.id)).map((c) => c.id)).toContain(body.id);
    expect((await listQrCodes(other.id)).map((c) => c.id)).not.toContain(body.id);
  });

  it("a dynamic website code keeps its destination and stays a draft without a short link", async () => {
    await clear();
    const res = await call({ ...valid, mode: "dynamic", destination: "littlefern.cafe/today" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await pool.query("select status, short_code, destination from qr_code where id = $1", [id])).rows[0]).toEqual({
      status: "draft",
      short_code: null,
      destination: "https://littlefern.cafe/today",
    });
  });

  it("fields that choose an owner, address existing codes or layouts, claim a draft or set state are refused; nothing changes", async () => {
    await clear();
    const before = await rows();
    const attempts: [Record<string, unknown>, string][] = [
      [{ ...valid, userId: other.id }, "userId"],
      [{ ...valid, ownerId: other.id }, "ownerId"],
      [{ ...valid, qrCodeId: otherCode.id }, "qrCodeId"],
      [{ ...valid, id: otherCode.id }, "id"],
      [{ ...valid, layouts: [{ ...layout, id: otherCode.layoutId }] }, "layouts[0].id"],
      [{ ...valid, claimKey: "abcdefghijklmnop" }, "claimKey"],
      [{ ...valid, status: "active" }, "status"],
      [{ ...valid, shortCode: "abc123" }, "shortCode"],
      [{ ...valid, paid: true }, "paid"],
      [{ ...valid, trial: true }, "trial"],
    ];
    for (const [body, path] of attempts) {
      const res = await call(body);
      expect(res.status, path).toBe(422);
      const json = (await res.json()) as { error: { code: string; details: { path: string; message: string }[] } };
      expect(json.error.code).toBe("invalid_request");
      expect(json.error.details).toContainEqual({ path, message: "Unknown field" });
    }
    expect(await rows()).toBe(before);
  });

  it("a missing, malformed, unknown, wrong or revoked key gets the same 401 and leaves no rows", async () => {
    await clear();
    const revoked = await createApiKey(db, owner.id);
    await revokeApiKey(db, owner.id, revoked.id);
    const wrong = `${ownerKey.slice(0, -1)}${ownerKey.endsWith("A") ? "B" : "A"}`;
    const before = await rows();
    const answers = [];
    for (const auth of [
      null,
      "",
      "Bearer",
      "Basic abc",
      `Token ${ownerKey}`,
      "Bearer hqk_nope",
      `Bearer ${wrong}`,
      `Bearer ${revoked.key}`,
    ]) {
      const res = await call(valid, auth);
      answers.push({ status: res.status, auth: res.headers.get("www-authenticate"), body: await res.text() });
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]?.status).toBe(401);
    expect(answers[0]?.auth).toBe('Bearer realm="heyqr"');
    // An invalid key is refused before the body is read: a malformed body gets the same 401.
    expect((await call("{oops", `Bearer ${revoked.key}`)).status).toBe(401);
    expect(await rows()).toBe(before);
  });

  it("malformed JSON, invalid content, mode, destination and layouts get consistent errors and save nothing", async () => {
    await clear();
    const before = await rows();
    const cases: [unknown, number, string, string?][] = [
      ["{oops", 400, "malformed_json"],
      ["", 400, "malformed_json"],
      [[], 422, "invalid_request", "(body)"],
      [{ ...valid, name: " " }, 422, "invalid_request", "name"],
      [{ ...valid, content: { type: "fax", number: "1" } }, 422, "invalid_request", "content.type"],
      [{ ...valid, content: { type: "website", url: "not a url" } }, 422, "invalid_request", "content.url"],
      [
        { ...valid, content: { type: "wifi", ssid: "Cafe", security: "WPA", password: "short" } },
        422,
        "invalid_request",
        "content.password",
      ],
      [{ ...valid, content: { type: "text", text: "hi", extra: 1 } }, 422, "invalid_request", "content.extra"],
      [{ ...valid, mode: "dynamic", content: { type: "text", text: "hi" } }, 422, "invalid_request", "mode"],
      [{ ...valid, destination: "https://elsewhere.test" }, 422, "invalid_request", "destination"],
      [{ ...valid, mode: "dynamic", destination: "has spaces .com" }, 422, "invalid_request", "destination"],
      [{ ...valid, layouts: [] }, 422, "invalid_request", "layouts"],
      [{ ...valid, layouts: [{ name: "Broken", layout: { nope: true } }] }, 422, "invalid_request", "layouts"],
    ];
    for (const [body, status, code, path] of cases) {
      const res = await call(body);
      const json = (await res.json()) as { error: { code: string; message: string; details?: { path: string }[] } };
      expect([res.status, json.error.code], JSON.stringify(body).slice(0, 80)).toEqual([status, code]);
      expect(json.error.message).toEqual(expect.any(String));
      if (path) expect(json.error.details?.map((d) => d.path)).toContain(path);
    }
    expect(await rows()).toBe(before);
  });

  it("the editor's draft limit applies; the request over it is refused and creates nothing", async () => {
    await clear();
    for (let i = 0; i < DRAFT_LIMIT; i++) expect((await call({ ...valid, name: `Draft ${i}` })).status).toBe(201);
    const before = await rows();
    const res = await call({ ...valid, name: "One too many" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("draft_limit");
    expect(await rows()).toBe(before);
  });

  it("keys, verifiers and internal errors stay out of responses and logs", async () => {
    await clear();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = await (await call(valid)).text();
    const refused = await (await call({ ...valid, userId: other.id })).text();
    // A failure inside the save: only the error's name is logged, the response is generic.
    apiDb.current = new Proxy(db, {
      get: (target, prop) =>
        prop === "transaction" ? () => Promise.reject(new Error(`boom ${ownerKey} insert into qr_code`)) : Reflect.get(target, prop),
    });
    const failed = await call(valid);
    apiDb.current = db;
    const failedText = await failed.text();
    expect(failed.status).toBe(500);
    expect(JSON.parse(failedText)).toEqual({ error: { code: "internal_error", message: expect.any(String) } });
    const secret = ownerKey.slice(17);
    const hash = (await pool.query("select secret_hash from api_key where user_id = $1 limit 1", [owner.id])).rows[0].secret_hash as string;
    const logs = JSON.stringify(logged.mock.calls);
    for (const text of [ok, refused, failedText, logs]) {
      expect([text.includes(secret), text.includes(hash), text.includes("boom"), text.includes("insert into")]).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
    expect(logs).toContain("[api/v1/qr-codes] failed: Error");
    logged.mockRestore();
  });
});

/* HEY-156 / QR-21.04: GET and PATCH /api/v1/qr-codes/{qrCodeId}/layouts/{layoutId}, through the route handlers. */
describe.skipIf(!url)("public API: read and update a layout (HEY-156, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  type Handler = (request: Request, ctx: { params: Promise<{ qrCodeId: string; layoutId: string }> }) => Promise<Response>;
  let GET: Handler;
  let PATCH: Handler;
  let createPOST: (request: Request) => Promise<Response>;
  const owner = { id: "api156-owner", name: "Owner", email: "owner@api156.test" };
  const other = { id: "api156-other", name: "Other", email: "other@api156.test" };
  let key = "";
  let otherKey = "";
  const look = (fg: string, caption = "Menu") => {
    const d = { ...DEFAULT_DESIGN, fg, preset: "frame" as const, frameStyle: "bubble" as const, caption };
    return { layout: designToLayout(d), editor: designSettingsOf(d) };
  };
  const base = "http://localhost/api/v1/qr-codes";
  const ctx = (qrCodeId: string, layoutId: string) => ({ params: Promise.resolve({ qrCodeId, layoutId }) });
  const get = (qrCodeId: string, layoutId: string, auth: string | null = `Bearer ${key}`) =>
    GET(
      new Request(`${base}/${qrCodeId}/layouts/${layoutId}`, { headers: auth === null ? {} : { authorization: auth } }),
      ctx(qrCodeId, layoutId),
    );
  const patch = (qrCodeId: string, layoutId: string, body: unknown, auth: string | null = `Bearer ${key}`) =>
    PATCH(
      new Request(`${base}/${qrCodeId}/layouts/${layoutId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      ctx(qrCodeId, layoutId),
    );
  const create = async (body: Record<string, unknown>, k = key) => {
    const res = await createPOST(
      new Request(base, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${k}` },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; layouts: { id: string }[] };
  };
  /** Everything stored for these accounts' codes and layouts, to show a refused request changed nothing. */
  const snapshot = async () =>
    JSON.stringify(
      (
        await pool.query(
          "select q.id, q.name, q.content, q.model, q.status, q.destination, q.short_code, q.updated_at, l.id as lid, l.name as lname, l.design, l.updated_at as lup, l.sort_order from qr_code q join qr_layout l on l.qr_code_id = q.id where q.user_id in ($1, $2) order by q.id, l.sort_order",
          [owner.id, other.id],
        )
      ).rows,
    );
  const designOf = async (layoutId: string) => (await pool.query("select design from qr_layout where id = $1", [layoutId])).rows[0]?.design;
  const codeRow = async (id: string) =>
    (
      await pool.query(
        "select user_id, name, content, model, status, destination, short_code, guest_claim_key from qr_code where id = $1",
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    apiDb.current = db;
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
    key = (await createApiKey(db, owner.id)).key;
    otherKey = (await createApiKey(db, other.id)).key;
    ({ GET, PATCH } = (await import("../../app/api/v1/qr-codes/[qrCodeId]/layouts/[layoutId]/route")) as unknown as {
      GET: Handler;
      PATCH: Handler;
    });
    ({ POST: createPOST } = await import("../../app/api/v1/qr-codes/route"));
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("create → GET → PATCH → GET: only the selected layout changes; the code and its other layouts keep everything", async () => {
    const made = await create({
      name: "Menu",
      mode: "static",
      content: { type: "website", url: "littlefern.cafe/menu" },
      layouts: [
        { name: "Sticker", ...look("#1F3A5F") },
        { name: "Poster", ...look("#2F6B3A") },
      ],
    });
    const [first, second] = made.layouts.map((l) => l.id) as [string, string];
    const codeBefore = await codeRow(made.id);
    const siblingBefore = await designOf(second);

    const read = await get(made.id, first);
    expect([read.status, read.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const got = (await read.json()) as Record<string, unknown> & { revision: string; layout: { colors: { fg: string } } };
    expect(Object.keys(got).sort()).toEqual(["editor", "id", "layout", "name", "qrCodeId", "revision"]);
    expect(got).toMatchObject({ id: first, qrCodeId: made.id, name: "Sticker", revision: expect.stringMatching(/^\d+$/) });
    expect(got.layout.colors.fg).toBe("#1F3A5F");

    const next = look("#8C2F4B", "Today");
    const res = await patch(made.id, first, { revision: got.revision, name: "Sticker v2", ...next });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as typeof got;
    expect(updated).toMatchObject({ id: first, qrCodeId: made.id, name: "Sticker v2" });
    expect(updated.revision).not.toBe(got.revision);
    expect(updated.layout.colors.fg).toBe("#8C2F4B");
    expect(await (await get(made.id, first)).json()).toEqual(updated);

    expect(await codeRow(made.id)).toEqual(codeBefore);
    expect(await designOf(second)).toEqual(siblingBefore);
    // The editor reads the same stored record.
    const stored = readLayoutRecord(await designOf(first));
    expect(stored.ok && stored.value.layout.colors.fg).toBe("#8C2F4B");
  });

  it("an active Dynamic code keeps its destination, short link and state when a layout changes", async () => {
    const made = await create({
      name: "Live",
      mode: "dynamic",
      content: { type: "website", url: "littlefern.cafe" },
      destination: "littlefern.cafe/today",
      layouts: [{ name: "Card", ...look("#1F3A5F") }],
    });
    const layoutId = made.layouts[0]?.id ?? "";
    // Fixture: activation done by the existing flows (labelled: set directly here).
    await pool.query("update qr_code set status = 'active', short_code = 'qa156live' where id = $1", [made.id]);
    const before = await codeRow(made.id);
    const { revision } = (await (await get(made.id, layoutId)).json()) as { revision: string };
    expect((await patch(made.id, layoutId, { revision, ...look("#2F6B3A") })).status).toBe(200);
    expect(await codeRow(made.id)).toEqual(before);
    expect(before).toMatchObject({ status: "active", short_code: "qa156live", destination: "https://littlefern.cafe/today" });
  });

  it("a foreign, deleted, missing or mismatched code/layout pair gets the same 404 and changes nothing", async () => {
    const mine = await create({
      name: "A",
      mode: "static",
      content: { type: "text", text: "a" },
      layouts: [{ name: "A1", ...look("#1F3A5F") }],
    });
    const mine2 = await create({
      name: "B",
      mode: "static",
      content: { type: "text", text: "b" },
      layouts: [{ name: "B1", ...look("#1F3A5F") }],
    });
    const theirs = await create(
      { name: "C", mode: "static", content: { type: "text", text: "c" }, layouts: [{ name: "C1", ...look("#1F3A5F") }] },
      otherKey,
    );
    const gone = await create({
      name: "D",
      mode: "static",
      content: { type: "text", text: "d" },
      layouts: [{ name: "D1", ...look("#1F3A5F") }],
    });
    await softDeleteQrCodes(db, owner.id, [gone.id]);
    const [a1, b1, c1, d1] = [mine, mine2, theirs, gone].map((c) => c.layouts[0]?.id ?? "");
    const { revision } = (await (await get(mine.id, a1)).json()) as { revision: string };
    const pairs: [string, string][] = [
      [theirs.id, c1], // another account's code
      [mine.id, b1], // my layout, under my other code
      [theirs.id, a1], // my layout under their code
      [gone.id, d1], // deleted
      [mine.id, "no-such-layout"],
      ["no-such-code", a1],
      ["bad id!", a1],
    ];
    const before = await snapshot();
    const answers = new Set<string>();
    for (const [q, l] of pairs) {
      for (const res of [await get(q, l), await patch(q, l, { revision, ...look("#000000") })])
        answers.add(`${res.status} ${await res.text()}`);
    }
    expect([...answers]).toEqual(['404 {"error":{"code":"not_found","message":"No such QR code or layout for this API key."}}']);
    expect(await snapshot()).toBe(before);
  });

  it("missing, invalid and revoked keys get the same 401 for GET and PATCH", async () => {
    const made = await create({
      name: "K",
      mode: "static",
      content: { type: "text", text: "k" },
      layouts: [{ name: "K1", ...look("#1F3A5F") }],
    });
    const layoutId = made.layouts[0]?.id ?? "";
    const { revision } = (await (await get(made.id, layoutId)).json()) as { revision: string };
    const revoked = await createApiKey(db, owner.id);
    await revokeApiKey(db, owner.id, revoked.id);
    const before = await snapshot();
    const answers = new Set<string>();
    for (const auth of [null, "Bearer hqk_nope", `Bearer ${revoked.key}`]) {
      for (const res of [await get(made.id, layoutId, auth), await patch(made.id, layoutId, { revision, ...look("#000000") }, auth)])
        answers.add(`${res.status} ${res.headers.get("www-authenticate")} ${await res.text()}`);
    }
    expect(answers.size).toBe(1);
    expect([...answers][0]).toMatch(/^401 Bearer realm="heyqr" /);
    expect(await snapshot()).toBe(before);
  });

  it("invalid design data, unknown fields and a missing revision are refused; the stored design is unchanged", async () => {
    const made = await create({
      name: "V",
      mode: "static",
      content: { type: "text", text: "v" },
      layouts: [{ name: "V1", ...look("#1F3A5F") }],
    });
    const layoutId = made.layouts[0]?.id ?? "";
    const { revision } = (await (await get(made.id, layoutId)).json()) as { revision: string };
    const before = await snapshot();
    const cases: [unknown, number, string, string?][] = [
      ["{oops", 400, "malformed_json"],
      [{ revision, layout: { nope: true } }, 422, "invalid_request", "layout"],
      [{ revision, editor: { preset: 42 } }, 422, "invalid_request", "editor"],
      [{ ...look("#000000") }, 422, "invalid_request", "revision"],
      [{ revision: "yesterday", ...look("#000000") }, 422, "invalid_request", "revision"],
      [{ revision }, 422, "invalid_request", "(body)"],
      [{ revision, name: " " }, 422, "invalid_request", "name"],
      [{ revision, ...look("#000000"), content: { type: "text", text: "other" } }, 422, "invalid_request", "content"],
      [{ revision, ...look("#000000"), destination: "https://elsewhere.test" }, 422, "invalid_request", "destination"],
      [{ revision, ...look("#000000"), qrCodeId: "x" }, 422, "invalid_request", "qrCodeId"],
      [{ revision, ...look("#000000"), id: "x" }, 422, "invalid_request", "id"],
      [{ revision, ...look("#000000"), status: "active" }, 422, "invalid_request", "status"],
    ];
    for (const [body, status, code, path] of cases) {
      const res = await patch(made.id, layoutId, body);
      const json = (await res.json()) as { error: { code: string; details?: { path: string }[] } };
      expect([res.status, json.error.code], JSON.stringify(body).slice(0, 60)).toEqual([status, code]);
      if (path) expect(json.error.details?.map((d) => d.path)).toContain(path);
    }
    expect(await snapshot()).toBe(before);
  });

  it("two updates with the same revision: one wins, the other gets 409; a stale revision later also gets 409", async () => {
    const made = await create({
      name: "R",
      mode: "static",
      content: { type: "text", text: "r" },
      layouts: [{ name: "R1", ...look("#1F3A5F") }],
    });
    const layoutId = made.layouts[0]?.id ?? "";
    const { revision } = (await (await get(made.id, layoutId)).json()) as { revision: string };
    const [x, y] = await Promise.all([
      patch(made.id, layoutId, { revision, ...look("#8C2F4B") }),
      patch(made.id, layoutId, { revision, ...look("#2F6B3A") }),
    ]);
    const statuses = [x.status, y.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe("revision_conflict");
    const winner = (await (x.status === 200 ? x : y).json()) as { layout: { colors: { fg: string } }; revision: string };
    const afterRace = await snapshot();
    const stored = readLayoutRecord(await designOf(layoutId));
    expect(stored.ok && stored.value.layout.colors.fg).toBe(winner.layout.colors.fg);
    // The old revision stays stale.
    expect((await patch(made.id, layoutId, { revision, ...look("#000000") })).status).toBe(409);
    expect(await snapshot()).toBe(afterRace);
    // The winner's revision works.
    expect((await patch(made.id, layoutId, { revision: winner.revision, name: "R1 v3" })).status).toBe(200);
  });

  it("stored logo references stay internal: GET never returns asset ids; a name-only PATCH keeps the stored logo", async () => {
    const objects = new Map<string, Uint8Array>();
    const store: LogoStore = {
      put: async (k, b) => void objects.set(k, b),
      get: async (k) => objects.get(k) ?? null,
      remove: async (k) => void objects.delete(k),
    };
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const d = { ...DEFAULT_DESIGN, preset: "horizontal" as const, caption: "Logo card", logo: { kind: "image" as const, href: PNG } };
    let n = 0;
    const saved = await saveQrWithLayouts(
      db,
      owner.id,
      {
        name: "Logo",
        model: "static",
        content: { type: "text", text: "logo" },
        layouts: [{ name: "L1", layout: designToLayout(d), editor: designSettingsOf(d) }],
      },
      (tx, rec) => storeLogos(tx, store, owner.id, rec, () => `api156asset${++n}`),
    );
    if (!saved.ok) throw new Error("fixture");
    const [qrId, layoutId] = [saved.data.qrCodeId, saved.data.layoutIds[0] ?? ""];
    expect(JSON.stringify(await designOf(layoutId))).toContain("asset:api156asset1");
    // The route (no storage configured here): the reference is dropped, not returned.
    const text = await (await get(qrId, layoutId)).text();
    expect(text).not.toMatch(/asset:|storage|logos\//);
    // With storage, the owner gets the image itself.
    const resolved = await readLayoutForOwner(db, owner.id, qrId, layoutId, store);
    expect(resolved?.layout.style.logo?.href).toBe(PNG);
    const { revision } = JSON.parse(text) as { revision: string };
    const before = await designOf(layoutId);
    expect((await patch(qrId, layoutId, { revision, name: "L1 renamed" })).status).toBe(200);
    expect(await designOf(layoutId)).toEqual(before);
  });
});

/* HEY-157 / QR-21.05: GET and PATCH /api/v1/qr-codes/{qrCodeId}/destination, through the route handlers. */
describe.skipIf(!url)("public API: a Dynamic code's destination (HEY-157, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  type Handler = (request: Request, ctx: { params: Promise<{ qrCodeId: string }> }) => Promise<Response>;
  let GET: Handler;
  let PATCH: Handler;
  let createPOST: (request: Request) => Promise<Response>;
  const owner = { id: "api157-owner", name: "Owner", email: "owner@api157.test" };
  const other = { id: "api157-other", name: "Other", email: "other@api157.test" };
  let key = "";
  let otherKey = "";
  const d = { ...DEFAULT_DESIGN, fg: "#1F3A5F" };
  const layouts = [{ name: "Card", layout: designToLayout(d), editor: designSettingsOf(d) }];
  const base = "http://localhost/api/v1/qr-codes";
  const ctx = (qrCodeId: string) => ({ params: Promise.resolve({ qrCodeId }) });
  const get = (qrCodeId: string, auth: string | null = `Bearer ${key}`) =>
    GET(new Request(`${base}/${qrCodeId}/destination`, { headers: auth === null ? {} : { authorization: auth } }), ctx(qrCodeId));
  const patch = (qrCodeId: string, body: unknown, auth: string | null = `Bearer ${key}`) =>
    PATCH(
      new Request(`${base}/${qrCodeId}/destination`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      ctx(qrCodeId),
    );
  const create = async (body: Record<string, unknown>, k = key) => {
    const res = await createPOST(
      new Request(base, { method: "POST", headers: { authorization: `Bearer ${k}` }, body: JSON.stringify({ layouts, ...body }) }),
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; layouts: { id: string }[] };
  };
  const dynamic = (name: string, k = key) =>
    create({ name, mode: "dynamic", content: { type: "website", url: "littlefern.cafe" }, destination: "littlefern.cafe/menu" }, k);
  const history = async (id: string) =>
    (await pool.query("select previous_url, new_url from destination_change where qr_code_id = $1 order by id", [id])).rows;
  const preserved = async (id: string) =>
    JSON.stringify([
      (
        await pool.query("select id, user_id, name, content, model, status, short_code, is_trial, deleted_at from qr_code where id = $1", [
          id,
        ])
      ).rows,
      (await pool.query("select id, name, design, sort_order, updated_at from qr_layout where qr_code_id = $1 order by sort_order", [id]))
        .rows,
      (await pool.query("select * from scan_daily where qr_code_id = $1 order by day", [id])).rows,
    ]);
  const everything = async () =>
    JSON.stringify([
      (
        await pool.query(
          "select id, destination, previous_destination, destination_changed_at, destination_revision from qr_code where user_id in ($1, $2) order by id",
          [owner.id, other.id],
        )
      ).rows,
      (
        await pool.query(
          "select d.* from destination_change d join qr_code q on q.id = d.qr_code_id where q.user_id in ($1, $2) order by d.id",
          [owner.id, other.id],
        )
      ).rows,
    ]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    apiDb.current = db;
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
    key = (await createApiKey(db, owner.id)).key;
    otherKey = (await createApiKey(db, other.id)).key;
    ({ GET, PATCH } = (await import("../../app/api/v1/qr-codes/[qrCodeId]/destination/route")) as unknown as {
      GET: Handler;
      PATCH: Handler;
    });
    ({ POST: createPOST } = await import("../../app/api/v1/qr-codes/route"));
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("read, then a real change: destination updated, revision +1, one history entry; id, short link, layouts, scans and state kept", async () => {
    const made = await dynamic("Live");
    // Activated through the app's own trial flow (no card), so the short link redirects.
    expect((await startTrial(db, owner.id, false)).ok).toBe(true);
    expect((await activateTrialCode(db, owner.id, made.id, () => "qa157live")).ok).toBe(true);
    await incrementScan(db, made.id);
    const before = await preserved(made.id);

    const read = await get(made.id);
    expect([read.status, read.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const current = (await read.json()) as Record<string, unknown> & { revision: number };
    expect(current).toEqual({
      qrCodeId: made.id,
      destination: "https://littlefern.cafe/menu",
      revision: 0,
      previousDestination: null,
      changedAt: null,
      shortLink: "https://heyqr.test/r/qa157live",
    });

    const res = await patch(made.id, { destination: "littlefern.cafe/today", revision: current.revision });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      qrCodeId: made.id,
      destination: "https://littlefern.cafe/today",
      revision: 1,
      previousDestination: "https://littlefern.cafe/menu",
      changedAt: expect.any(String),
      shortLink: "https://heyqr.test/r/qa157live",
      changed: true,
    });
    expect(await history(made.id)).toEqual([{ previous_url: "https://littlefern.cafe/menu", new_url: "https://littlefern.cafe/today" }]);
    expect(await preserved(made.id)).toBe(before);
    // What the dashboard's QR details and the short link read.
    expect((await destinationHistory(db, owner.id, made.id)).map((h) => h.newUrl)).toEqual(["https://littlefern.cafe/today"]);
    expect(await resolveShortLink(db, "qa157live")).toMatchObject({ to: "https://littlefern.cafe/today" });
    // GET shows the same state; only PATCH adds `changed`.
    expect({ ...((await (await get(made.id)).json()) as object), changed: true }).toEqual(body);
  });

  it("the same URL at the current revision changes nothing: same revision, no history entry", async () => {
    const made = await dynamic("Same");
    const before = await everything();
    for (const destination of ["https://littlefern.cafe/menu", "littlefern.cafe/menu"]) {
      const res = await patch(made.id, { destination, revision: 0 });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ destination: "https://littlefern.cafe/menu", revision: 0, changed: false });
    }
    expect(await everything()).toBe(before);
    expect(await history(made.id)).toEqual([]);
  });

  it("a stale revision gets 409 with only the current destination and revision; nothing is written", async () => {
    const made = await dynamic("Stale");
    expect((await patch(made.id, { destination: "littlefern.cafe/a", revision: 0 })).status).toBe(200);
    expect((await patch(made.id, { destination: "littlefern.cafe/menu", revision: 1 })).status).toBe(200);
    const before = await everything();
    // A → B → A: the URL matches again, but revision 0 is still stale.
    for (const destination of ["littlefern.cafe/menu", "littlefern.cafe/b"]) {
      const res = await patch(made.id, { destination, revision: 0 });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: {
          code: "revision_conflict",
          message: expect.any(String),
          current: { destination: "https://littlefern.cafe/menu", revision: 2 },
        },
      });
    }
    expect(await everything()).toBe(before);
  });

  it("another account's, deleted, missing and malformed codes get one 404; static codes have no destination; keys must verify", async () => {
    const theirs = await dynamic("Theirs", otherKey);
    const gone = await dynamic("Gone");
    await softDeleteQrCodes(db, owner.id, [gone.id]);
    const flat = await create({ name: "Flat", mode: "static", content: { type: "text", text: "flat" } });
    const revoked = await createApiKey(db, owner.id);
    await revokeApiKey(db, owner.id, revoked.id);
    const before = await everything();
    const notFound = new Set<string>();
    for (const id of [theirs.id, gone.id, "no-such-code", "bad id!"])
      for (const res of [await get(id), await patch(id, { destination: "https://evil.test", revision: 0 })])
        notFound.add(`${res.status} ${await res.text()}`);
    expect([...notFound]).toEqual(['404 {"error":{"code":"not_found","message":"No such QR code or layout for this API key."}}']);
    for (const res of [await get(flat.id), await patch(flat.id, { destination: "https://elsewhere.test", revision: 0 })])
      expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([422, "not_dynamic"]);
    const unauthorized = new Set<string>();
    for (const auth of [null, "Bearer hqk_nope", `Bearer ${revoked.key}`])
      for (const res of [await get(theirs.id, auth), await patch(theirs.id, { destination: "https://evil.test", revision: 0 }, auth)])
        unauthorized.add(`${res.status} ${await res.text()}`);
    expect(unauthorized.size).toBe(1);
    expect([...unauthorized][0]).toMatch(/^401 /);
    expect(await everything()).toBe(before);
  });

  it("invalid URLs and bodies are refused with the dashboard's rule; nothing is written", async () => {
    const made = await dynamic("Rules");
    const before = await everything();
    const cases: [unknown, number, string, string][] = [
      ["{oops", 400, "malformed_json", ""],
      [{ destination: "", revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: "has spaces.com", revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: "ftp://files.test/menu", revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: "javascript:alert(1)", revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: "https://user:pass@site.test", revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: "localhost", revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: `https://x.test/${"a".repeat(2050)}`, revision: 0 }, 422, "invalid_request", "destination"],
      [{ destination: "https://ok.test" }, 422, "invalid_request", "revision"],
      [{ destination: "https://ok.test", revision: "0" }, 422, "invalid_request", "revision"],
      [{ destination: "https://ok.test", revision: -1 }, 422, "invalid_request", "revision"],
      [{ destination: "https://ok.test", revision: 0, shortCode: "mine" }, 422, "invalid_request", "shortCode"],
      [{ destination: "https://ok.test", revision: 0, status: "active" }, 422, "invalid_request", "status"],
    ];
    for (const [body, status, code, path] of cases) {
      const res = await patch(made.id, body);
      const json = (await res.json()) as { error: { code: string; details?: { path: string }[] } };
      expect([res.status, json.error.code], JSON.stringify(body).slice(0, 60)).toEqual([status, code]);
      if (path) expect(json.error.details?.map((x) => x.path)).toContain(path);
    }
    expect(await everything()).toBe(before);
  });

  it("an API update and a dashboard update with the same revision: exactly one wins, with one history entry", async () => {
    for (let round = 0; round < 5; round++) {
      const made = await dynamic(`Race ${round}`);
      const [api, dashboard] = await Promise.all([
        patch(made.id, { destination: "https://api.test/menu", revision: 0 }),
        // The dashboard's Change destination action: the same function, for the session's user.
        changeDestination(db, owner.id, made.id, "https://dashboard.test/menu", 0),
      ]);
      const apiWon = api.status === 200;
      expect([api.status, dashboard.ok ? "ok" : dashboard.error].sort()).toEqual(apiWon ? [200, "conflict"] : [409, "ok"]);
      const winner = apiWon ? "https://api.test/menu" : "https://dashboard.test/menu";
      expect(await history(made.id)).toEqual([{ previous_url: "https://littlefern.cafe/menu", new_url: winner }]);
      const [row] = (await pool.query("select destination, destination_revision from qr_code where id = $1", [made.id])).rows;
      expect(row).toEqual({ destination: winner, destination_revision: 1 });
      if (!apiWon)
        expect(((await api.json()) as { error: { current: unknown } }).error.current).toEqual({ destination: winner, revision: 1 });
    }
  });
});

/* HEY-158 / QR-21.06: who may export through the public API (the dashboard's download rule, on every request). */
describe.skipIf(!url)("public API: export authorization (HEY-158, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "api158-owner", name: "Owner", email: "owner@api158.test" };
  const other = { id: "api158-other", name: "Other", email: "other@api158.test" };
  const appUrl = "https://heyqr.test";
  const d = { ...DEFAULT_DESIGN, fg: "#1F3A5F" };
  const layout = { name: "Card", layout: designToLayout(d), editor: designSettingsOf(d) };
  const save = async (userId: string, model: "static" | "dynamic", layouts = [layout]) => {
    const saved = await saveQrWithLayouts(db, userId, {
      name: `Code ${model}`,
      model,
      content: model === "static" ? { type: "text", text: "menu" } : { type: "website", url: "https://littlefern.cafe" },
      layouts,
    });
    if (!saved.ok) throw new Error("fixture");
    return { id: saved.data.qrCodeId, layouts: saved.data.layoutIds };
  };
  const decide = (userId: string, qrCodeId: string, layoutId: string, query: Record<string, string> = { format: "png" }) =>
    authorizeApiExport(db, userId, { qrCodeId, layoutId, query }, { appUrl });
  /** Fixture: the unlock a verified purchase leaves (canDownload's static rule is purchasedAt alone), set directly. */
  const unlock = (id: string, at: Date | null) => pool.query("update qr_code set purchased_at = $2 where id = $1", [id, at]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [owner.id, other.id]));
    await pool?.end();
  });

  it("an unpaid Static code gets payment_required with a HeyQR URL for the same code, layout and format; nothing is created", async () => {
    const code = await save(owner.id, "static", [layout, { ...layout, name: "Poster" }]);
    const [first, second] = code.layouts as [string, string];
    const orders = async () => (await pool.query("select count(*)::int as n from purchase where user_id = $1", [owner.id])).rows[0].n;
    const before = await orders();
    expect(await decide(owner.id, code.id, second, { format: "pdf" })).toEqual({
      ok: false,
      error: "payment_required",
      paymentUrl: `${appUrl}/create/export?qr=${code.id}&layout=${second}&format=pdf`,
      qrCodeId: code.id,
      layoutId: second,
      format: "pdf",
      mode: "static",
    });
    const png = await decide(owner.id, code.id, first, { format: "png", dpi: "600", transparent: "1" });
    expect(png.ok ? null : "paymentUrl" in png && png.paymentUrl).toBe(
      `${appUrl}/create/export?qr=${code.id}&layout=${first}&format=png&res=600&transparent=1`,
    );
    expect(await orders()).toBe(before);
  });

  it("a paid Static code is allowed for every format; once the entitlement is revoked it isn't, on the very next request", async () => {
    const code = await save(owner.id, "static");
    const layoutId = code.layouts[0] ?? "";
    await unlock(code.id, new Date());
    for (const format of ["png", "svg", "pdf"])
      expect(await decide(owner.id, code.id, layoutId, { format })).toMatchObject({ ok: true, options: { format } });
    expect(await decide(owner.id, code.id, layoutId, { format: "png", scale: "4" })).toEqual({
      ok: true,
      options: { format: "png", scale: 4, transparent: false },
    });
    // A refund takes the unlock away (HEY-100): the next request is refused, whatever is already stored.
    await unlock(code.id, null);
    expect(await decide(owner.id, code.id, layoutId)).toMatchObject({ ok: false, error: "payment_required" });
  });

  it("Dynamic codes follow the dashboard's rule: a draft needs activation; the running trial's test code is allowed", async () => {
    const draft = await save(owner.id, "dynamic");
    expect(await decide(owner.id, draft.id, draft.layouts[0] ?? "")).toMatchObject({
      ok: false,
      error: "payment_required",
      mode: "dynamic",
    });
    expect((await startTrial(db, owner.id, false)).ok).toBe(true);
    expect(await decide(owner.id, draft.id, draft.layouts[0] ?? "")).toMatchObject({ ok: false, error: "payment_required" });
    expect((await activateTrialCode(db, owner.id, draft.id, () => "qa158trial")).ok).toBe(true);
    expect(await decide(owner.id, draft.id, draft.layouts[0] ?? "")).toMatchObject({ ok: true });
  });

  it("another account's, deleted, missing and mismatched code/layout pairs are one not_found, even when paid", async () => {
    const mine = await save(owner.id, "static");
    const mine2 = await save(owner.id, "static");
    const theirs = await save(other.id, "static");
    const gone = await save(owner.id, "static");
    for (const c of [mine, mine2, theirs, gone]) await unlock(c.id, new Date());
    await softDeleteQrCodes(db, owner.id, [gone.id]);
    const [m, m2, t, g] = [mine, mine2, theirs, gone].map((c) => c.layouts[0] ?? "");
    const pairs: [string, string][] = [
      [theirs.id, t],
      [mine.id, m2],
      [theirs.id, m],
      [gone.id, g],
      [mine.id, "no-such-layout"],
      ["no-such-code", m],
      ["bad id!", m],
    ];
    for (const [q, l] of pairs) expect(await decide(owner.id, q, l), `${q}/${l}`).toEqual({ ok: false, error: "not_found" });
    expect(await decide(owner.id, mine.id, m)).toMatchObject({ ok: true });
  });

  it("the format and options are validated: missing, unknown, out of range and extra parameters are refused", async () => {
    const code = await save(owner.id, "static");
    await unlock(code.id, new Date());
    const layoutId = code.layouts[0] ?? "";
    for (const [query, path] of [
      [{}, "format"],
      [{ format: "gif" }, "format"],
      [{ format: "png", dpi: "5000" }, "dpi"],
      [{ format: "png", scale: "0" }, "scale"],
      [{ format: "png", transparent: "yes" }, "transparent"],
      [{ format: "png", prepare: "1" }, "prepare"],
      [{ format: "png", key: "hqk_x" }, "key"],
    ] as [Record<string, string>, string][]) {
      const out = await decide(owner.id, code.id, layoutId, query);
      expect(out.ok ? [] : "details" in out ? out.details.map((x) => x.path) : [out.error], JSON.stringify(query)).toContain(path);
    }
  });
});

/*
 * HEY-160 / QR-22.01: response bodies of the real route handlers against SDK-typed samples. Each sample is checked by
 * the compiler against the @heyqr/sdk type (`satisfies`); its shape (keys and value kinds) must equal the response's.
 */
describe.skipIf(!url)("SDK contract: route responses (HEY-160, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
  const routes: Record<string, { GET?: Handler; PATCH?: Handler; POST?: Handler }> = {};
  const owner = { id: "sdk160-owner", name: "Owner", email: "owner@sdk160.test" };
  let key = "";
  const d = { ...DEFAULT_DESIGN, fg: "#1F3A5F" };
  const layout = designToLayout(d);
  const editor = designSettingsOf(d);
  /** Keys and value kinds, recursively (designs collapse to "object": the SDK passes them through as JSON). */
  const shape = (v: unknown, keyName = ""): unknown => {
    if (keyName === "layout" || keyName === "editor") return v === null ? "null" : "object";
    if (v === null) return "null";
    if (Array.isArray(v)) return [v.length ? shape(v[0]) : "empty"];
    if (typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, shape(x, k)]),
      );
    return typeof v;
  };
  const send = async (
    route: string,
    method: "GET" | "PATCH" | "POST",
    path: string,
    body?: unknown,
    auth: string | null = `Bearer ${key}`,
  ) => {
    const handler = routes[route]?.[method];
    if (!handler) throw new Error(`${route} ${method}`);
    const params = Object.fromEntries(
      [...path.matchAll(/(qr-codes|layouts)\/([^/]+)/g)].map((m) => [m[1] === "qr-codes" ? "qrCodeId" : "layoutId", m[2]]),
    );
    const res = await handler(
      new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
      { params: Promise.resolve(params) },
    );
    return { status: res.status, body: (await res.json()) as unknown };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    apiDb.current = db;
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    key = (await createApiKey(db, owner.id)).key;
    routes.create = (await import("../../app/api/v1/qr-codes/route")) as never;
    routes.layout = (await import("../../app/api/v1/qr-codes/[qrCodeId]/layouts/[layoutId]/route")) as never;
    routes.destination = (await import("../../app/api/v1/qr-codes/[qrCodeId]/destination/route")) as never;
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("create, layout and destination responses have exactly the SDK's shapes", async () => {
    const createBody: Sdk.CreateQrRequest = {
      name: "Menu",
      mode: "static",
      content: { type: "website", url: "littlefern.cafe/menu" },
      layouts: [{ name: "Sticker", layout, editor }],
    };
    const created = await send("create", "POST", "/qr-codes", createBody);
    expect(created.status).toBe(201);
    expect(shape(created.body)).toEqual(shape({ id: "q", status: "draft", layouts: [{ id: "l" }] } satisfies Sdk.CreateQrResponse));
    const { id, layouts } = created.body as Sdk.CreateQrResponse;
    const layoutId = layouts[0]?.id ?? "";

    const read = await send("layout", "GET", `/qr-codes/${id}/layouts/${layoutId}`);
    const sampleLayout = {
      id: "l",
      qrCodeId: "q",
      name: "Sticker",
      revision: "1764061234567890",
      layout: {},
      editor: {},
    } satisfies Sdk.Layout;
    expect([read.status, shape(read.body)]).toEqual([200, shape(sampleLayout)]);
    const current = read.body as Sdk.Layout;
    expect(current.revision).toMatch(/^\d+$/);

    const update: Sdk.UpdateLayoutRequest = { revision: current.revision, name: "Sticker v2" };
    const updated = await send("layout", "PATCH", `/qr-codes/${id}/layouts/${layoutId}`, update);
    expect([updated.status, shape(updated.body)]).toEqual([200, shape(sampleLayout)]);
    const stale = await send("layout", "PATCH", `/qr-codes/${id}/layouts/${layoutId}`, update);
    expect([stale.status, shape(stale.body)]).toEqual([
      409,
      shape({ error: { code: "revision_conflict", message: "m" } } satisfies Sdk.LayoutRevisionConflictError),
    ]);

    const invalid = await send("create", "POST", "/qr-codes", { ...createBody, userId: "x" });
    const sampleInvalid = {
      error: { code: "invalid_request", message: "m", details: [{ path: "userId", message: "Unknown field" }] },
    } satisfies Sdk.InvalidRequestError;
    expect([invalid.status, shape(invalid.body)]).toEqual([422, shape(sampleInvalid)]);
    expect((await send("create", "POST", "/qr-codes", "{oops")).body).toEqual({
      error: { code: "malformed_json", message: expect.any(String) },
    } satisfies Sdk.MalformedJsonError);
    expect(shape((await send("layout", "GET", `/qr-codes/${id}/layouts/nope`)).body)).toEqual(
      shape({ error: { code: "not_found", message: "m" } } satisfies Sdk.NotFoundError),
    );
    expect(shape((await send("layout", "GET", `/qr-codes/${id}/layouts/${layoutId}`, undefined, null)).body)).toEqual(
      shape({ error: { code: "unauthorized", message: "m" } } satisfies Sdk.UnauthorizedError),
    );
    expect(shape((await send("destination", "GET", `/qr-codes/${id}/destination`)).body)).toEqual(
      shape({ error: { code: "not_dynamic", message: "m" } } satisfies Sdk.NotDynamicError),
    );

    const dyn = (
      await send("create", "POST", "/qr-codes", {
        ...createBody,
        mode: "dynamic",
        destination: "littlefern.cafe/menu",
      } satisfies Sdk.CreateQrRequest)
    ).body as Sdk.CreateQrResponse;
    const dest = await send("destination", "GET", `/qr-codes/${dyn.id}/destination`);
    // Before the first change and activation: the nullable fields are null.
    const sampleDestination = {
      qrCodeId: "q",
      destination: "https://x",
      revision: 0,
      previousDestination: null,
      changedAt: null,
      shortLink: null,
    } satisfies Sdk.Destination;
    expect([dest.status, shape(dest.body)]).toEqual([200, shape(sampleDestination)]);
    const change: Sdk.UpdateDestinationRequest = {
      destination: "littlefern.cafe/today",
      revision: (dest.body as Sdk.Destination).revision,
    };
    const changed = await send("destination", "PATCH", `/qr-codes/${dyn.id}/destination`, change);
    const sampleChanged = {
      ...sampleDestination,
      previousDestination: "https://x",
      changedAt: "t",
      changed: true,
    } satisfies Sdk.UpdateDestinationResponse;
    expect([changed.status, shape(changed.body)]).toEqual([200, shape(sampleChanged)]);
    const conflict = await send("destination", "PATCH", `/qr-codes/${dyn.id}/destination`, change);
    const sampleConflict = {
      error: { code: "revision_conflict", message: "m", current: { destination: "https://x", revision: 1 } },
    } satisfies Sdk.DestinationRevisionConflictError;
    expect([conflict.status, shape(conflict.body)]).toEqual([409, shape(sampleConflict)]);
  });
});

/*
 * HEY-162 / QR-22.03: the SDK client's update methods against the real route handlers and PostgreSQL. `fetch` is
 * dispatched to the handlers in-process, so this runs without a server; the live API run is in packages/sdk/test.
 */
describe.skipIf(!url)("SDK client updates against the routes (HEY-162, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "sdk162-owner", name: "Owner", email: "owner@sdk162.test" };
  let heyqr: HeyQrClient;
  const d = { ...DEFAULT_DESIGN, fg: "#1F3A5F", preset: "frame" as const, frameStyle: "bubble" as const, caption: "Menu" };
  const next = { ...d, fg: "#8C2F4B", caption: "Today" };
  type Handler = (request: Request, ctx: unknown) => Promise<Response>;
  let routes: { create: Record<string, Handler>; layout: Record<string, Handler>; destination: Record<string, Handler> };
  /** Routes a request the SDK makes to the matching route handler. */
  const inProcess: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    const [, qrCodeId, kind, layoutId] = /^\/qr-codes(?:\/([^/]+)(?:\/(layouts|destination)(?:\/([^/]+))?)?)?$/.exec(path) ?? [];
    const route = !qrCodeId ? routes.create : kind === "destination" ? routes.destination : routes.layout;
    const handler = route[init.method];
    if (!handler) return { status: 405, headers: { get: () => null }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    const params = Object.fromEntries(Object.entries({ qrCodeId, layoutId }).flatMap(([k, v]) => (v ? [[k, decodeURIComponent(v)]] : [])));
    const res = await handler(
      new Request(url, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) }),
      {
        params: Promise.resolve(params),
      },
    );
    return { status: res.status, headers: res.headers, text: () => res.text(), arrayBuffer: () => res.arrayBuffer() };
  };
  const stored = async (qrCodeId: string) => ({
    code: (
      await pool.query(
        "select destination, previous_destination, destination_revision, status, short_code, updated_at from qr_code where id = $1",
        [qrCodeId],
      )
    ).rows[0],
    layouts: (await pool.query("select id, name, design, updated_at from qr_layout where qr_code_id = $1 order by sort_order", [qrCodeId]))
      .rows,
    history: (await pool.query("select new_url from destination_change where qr_code_id = $1 order by id", [qrCodeId])).rows.map(
      (r) => r.new_url,
    ),
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    apiDb.current = db;
    await db.insert(schema.user).values(owner).onConflictDoNothing();
    routes = {
      create: (await import("../../app/api/v1/qr-codes/route")) as never,
      layout: (await import("../../app/api/v1/qr-codes/[qrCodeId]/layouts/[layoutId]/route")) as never,
      destination: (await import("../../app/api/v1/qr-codes/[qrCodeId]/destination/route")) as never,
    };
    heyqr = new HeyQrClient({ apiKey: (await createApiKey(db, owner.id)).key, baseUrl: "http://localhost", fetch: inProcess });
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  const create = () =>
    heyqr.createQr({
      name: "Live",
      mode: "dynamic",
      content: { type: "website", url: "littlefern.cafe" },
      destination: "littlefern.cafe/menu",
      layouts: [
        { name: "Sticker", layout: designToLayout(d), editor: designSettingsOf(d) },
        { name: "Poster", layout: designToLayout(d) },
      ],
    });

  it("each update changes only its own resource, from the revision its read returned", async () => {
    const created = await create();
    const [first, second] = created.layouts.map((l) => l.id) as [string, string];
    const layout0 = await heyqr.getLayout(created.id, first);
    const destination0 = await heyqr.getDestination(created.id);
    const before = await stored(created.id);

    // The layout: name, design and revision change; the destination and the other layout don't.
    const layout1 = await heyqr.updateLayout(created.id, first, {
      revision: layout0.revision,
      name: "Sticker v2",
      layout: designToLayout(next),
      editor: designSettingsOf(next),
    });
    expect(layout1).toMatchObject({ id: first, qrCodeId: created.id, name: "Sticker v2" });
    expect(layout1.revision).not.toBe(layout0.revision);
    expect((layout1.layout as { colors: { fg: string } }).colors.fg).toBe("#8C2F4B");
    expect(await heyqr.getDestination(created.id)).toEqual(destination0);
    const afterLayout = await stored(created.id);
    expect([afterLayout.code.destination, afterLayout.code.destination_revision, afterLayout.history]).toEqual([
      before.code.destination,
      0,
      [],
    ]);
    expect(afterLayout.layouts[1]).toEqual(before.layouts[1]);

    // The destination: revision +1 and one history entry; no layout changes.
    const moved = await heyqr.updateDestination(created.id, { destination: "littlefern.cafe/today", revision: destination0.revision });
    expect(moved).toEqual({
      ...destination0,
      destination: "https://littlefern.cafe/today",
      revision: 1,
      previousDestination: "https://littlefern.cafe/menu",
      changedAt: expect.any(String),
      changed: true,
    });
    expect(await heyqr.getLayout(created.id, first)).toEqual(layout1);
    const afterMove = await stored(created.id);
    expect(afterMove.layouts).toEqual(afterLayout.layouts);
    expect(afterMove.history).toEqual(["https://littlefern.cafe/today"]);

    // The same address again at the current revision: changed false, nothing written.
    const same = await heyqr.updateDestination(created.id, { destination: "https://littlefern.cafe/today", revision: moved.revision });
    expect([same.changed, same.revision]).toEqual([false, 1]);
    expect(await stored(created.id)).toEqual(afterMove);
    expect(second).toBeTruthy();
  });

  it("stale revisions: 409 with each endpoint's details, and the saved values stay exactly as they were", async () => {
    const created = await create();
    const layoutId = created.layouts[0]?.id ?? "";
    const layout0 = await heyqr.getLayout(created.id, layoutId);
    const destination0 = await heyqr.getDestination(created.id);
    const layout1 = await heyqr.updateLayout(created.id, layoutId, { revision: layout0.revision, name: "Sticker v2" });
    await heyqr.updateDestination(created.id, { destination: "littlefern.cafe/today", revision: destination0.revision });
    const saved = await stored(created.id);

    const staleLayout = await heyqr
      .updateLayout(created.id, layoutId, { revision: layout0.revision, name: "From an old read", layout: designToLayout(next) })
      .catch((e: unknown) => e);
    expect(isRevisionConflict(staleLayout)).toBe(true);
    expect(staleLayout).toMatchObject({
      status: 409,
      code: "revision_conflict",
      response: { body: { error: { code: "revision_conflict", message: expect.any(String) } } },
    });
    expect(await heyqr.getLayout(created.id, layoutId)).toEqual(layout1);

    const staleDestination = (await heyqr
      .updateDestination(created.id, { destination: "littlefern.cafe/old-read", revision: destination0.revision })
      .catch((e: unknown) => e)) as UpdateDestinationError;
    expect(isRevisionConflict(staleDestination)).toBe(true);
    const r = staleDestination.response;
    expect(r.status === 409 ? r.body.error.current : null).toEqual({ destination: "https://littlefern.cafe/today", revision: 1 });
    // A → B → A: even the stored URL from an old revision is refused.
    await expect(
      heyqr.updateDestination(created.id, { destination: "https://littlefern.cafe/today", revision: destination0.revision }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await stored(created.id)).toEqual(saved);
    // The caller decides: reload, then the same change succeeds from the current revision.
    const current = await heyqr.getDestination(created.id);
    expect(
      (await heyqr.updateDestination(created.id, { destination: "littlefern.cafe/old-read", revision: current.revision })).revision,
    ).toBe(2);
  });
});

/*
 * HEY-165 / QR-22.06: idempotent create through the SDK, the real create route and PostgreSQL (fetch dispatched to
 * the route in-process). Every case asserts the ids returned and the rows stored.
 */
describe.skipIf(!url)("idempotent create retries (HEY-165, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const a = { id: "idem-a", name: "A", email: "a@idem.test" };
  const b = { id: "idem-b", name: "B", email: "b@idem.test" };
  const keys: Record<string, string> = {};
  let createRoute: (request: Request) => Promise<Response>;
  const d = { ...DEFAULT_DESIGN, fg: "#1F3A5F" };
  const body = (name = "Menu", url = "https://littlefern.cafe/menu") => ({
    name,
    mode: "static" as const,
    content: { type: "website" as const, url },
    layouts: [
      { name: "Sticker", layout: designToLayout(d), editor: designSettingsOf(d) },
      { name: "Poster", layout: designToLayout(d) },
    ],
  });
  /** The SDK against the real route; `lose` drops the response after the server has handled the request. */
  const client = (user: string, opts: { lose?: () => boolean } = {}) => {
    const fetch: FetchLike = async (u, init) => {
      const res = await createRoute(
        new Request(u, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) }),
      );
      if (opts.lose?.()) throw new TypeError("socket hang up");
      return { status: res.status, headers: res.headers, text: () => res.text(), arrayBuffer: () => res.arrayBuffer() };
    };
    return new HeyQrClient({ apiKey: keys[user] ?? "", baseUrl: "http://localhost", fetch });
  };
  const counts = async (userId: string) => {
    const one = async (q: string) => Number((await pool.query(q, [userId])).rows[0].n);
    return {
      codes: await one("select count(*)::int as n from qr_code where user_id = $1"),
      layouts: await one("select count(*)::int as n from qr_layout l join qr_code c on c.id = l.qr_code_id where c.user_id = $1"),
      keys: await one("select count(*)::int as n from api_idempotency_key where user_id = $1"),
    };
  };
  const reset = async () => {
    await pool.query("delete from qr_code where user_id = any($1)", [[a.id, b.id]]);
    await pool.query("delete from api_idempotency_key where user_id = any($1)", [[a.id, b.id]]);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    apiDb.current = db;
    await db.insert(schema.user).values([a, b]).onConflictDoNothing();
    keys[a.id] = (await createApiKey(db, a.id)).key;
    keys[b.id] = (await createApiKey(db, b.id)).key;
    ({ POST: createRoute } = await import("../../app/api/v1/qr-codes/route"));
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(inArray(schema.user.id, [a.id, b.id]));
    await pool?.end();
  });

  it("a response lost after commit: the retry with the same key returns the same code and layouts; nothing more is stored", async () => {
    await reset();
    let lost = 0;
    const flaky = client(a.id, { lose: () => lost++ === 0 });
    const key = "retry-1f3a5f-0001";
    const first = await flaky.createQr(body(), { idempotencyKey: key }).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(HeyQrError);
    expect(first).toMatchObject({ kind: "network" });
    // The server did commit it.
    expect(await counts(a.id)).toEqual({ codes: 1, layouts: 2, keys: 1 });
    const stored = (await pool.query("select id from qr_code where user_id = $1", [a.id])).rows[0].id as string;
    const retried = await flaky.createQr(body(), { idempotencyKey: key });
    expect(retried.id).toBe(stored);
    const layoutIds = (await pool.query("select id from qr_layout where qr_code_id = $1 order by sort_order", [stored])).rows.map(
      (r) => r.id,
    );
    expect(retried).toEqual({ id: stored, status: "draft", layouts: layoutIds.map((id) => ({ id })) });
    expect(await counts(a.id)).toEqual({ codes: 1, layouts: 2, keys: 1 });
    // The raw route marks the replay.
    const raw = await createRoute(
      new Request("http://localhost/api/v1/qr-codes", {
        method: "POST",
        headers: { authorization: `Bearer ${keys[a.id]}`, "idempotency-key": key },
        body: JSON.stringify(body()),
      }),
    );
    expect([raw.status, raw.headers.get("idempotent-replayed")]).toEqual([201, "true"]);
  });

  it("concurrent matching requests create exactly one code and one set of layouts", async () => {
    await reset();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => client(a.id).createQr(body(), { idempotencyKey: "concurrent-0001" })),
    );
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(await counts(a.id)).toEqual({ codes: 1, layouts: 2, keys: 1 });
  });

  it("an equivalent request replays (normalized URL, trimmed name, other key order); a different one is 409 and stores nothing", async () => {
    await reset();
    const first = await client(a.id).createQr(body(), { idempotencyKey: "equiv-0001" });
    const reordered = {
      layouts: body().layouts,
      content: { url: "littlefern.cafe/menu", type: "website" as const },
      mode: "static" as const,
      name: "  Menu  ",
    };
    expect(await client(a.id).createQr(reordered, { idempotencyKey: "equiv-0001" })).toEqual(first);
    const before = await counts(a.id);
    const conflict = await client(a.id)
      .createQr(body("Another menu"), { idempotencyKey: "equiv-0001" })
      .catch((e: unknown) => e);
    expect(isIdempotencyConflict(conflict)).toBe(true);
    expect(conflict).toMatchObject({ status: 409, code: "idempotency_key_reused" });
    expect(await counts(a.id)).toEqual(before);
  });

  it("two accounts can use the same key independently", async () => {
    await reset();
    const [fromA, fromB] = await Promise.all([
      client(a.id).createQr(body(), { idempotencyKey: "shared-0001" }),
      client(b.id).createQr(body("B's menu"), { idempotencyKey: "shared-0001" }),
    ]);
    expect(fromA.id).not.toBe(fromB.id);
    expect((await pool.query("select user_id from qr_code where id = $1", [fromA.id])).rows[0].user_id).toBe(a.id);
    expect((await pool.query("select user_id from qr_code where id = $1", [fromB.id])).rows[0].user_id).toBe(b.id);
    expect([await counts(a.id), await counts(b.id)]).toEqual([
      { codes: 1, layouts: 2, keys: 1 },
      { codes: 1, layouts: 2, keys: 1 },
    ]);
    // B replaying its own key gets B's code; A's replay stays A's.
    expect((await client(b.id).createQr(body("B's menu"), { idempotencyKey: "shared-0001" })).id).toBe(fromB.id);
    expect((await client(a.id).createQr(body(), { idempotencyKey: "shared-0001" })).id).toBe(fromA.id);
  });

  it("a replay doesn't take a draft slot: at the limit, the replay is 201 and a new key is 403", async () => {
    await reset();
    for (let i = 0; i < DRAFT_LIMIT - 1; i++) await client(a.id).createQr(body(`Filler ${i}`));
    const last = await client(a.id).createQr(body("The tenth"), { idempotencyKey: "at-limit-0001" });
    expect((await counts(a.id)).codes).toBe(DRAFT_LIMIT);
    expect(await client(a.id).createQr(body("The tenth"), { idempotencyKey: "at-limit-0001" })).toEqual(last);
    await expect(client(a.id).createQr(body("One more"), { idempotencyKey: "at-limit-0002" })).rejects.toMatchObject({
      status: 403,
      code: "draft_limit",
    });
    expect((await counts(a.id)).codes).toBe(DRAFT_LIMIT);
  });

  it("a refused or rolled-back attempt stores nothing and stays retryable with the same key", async () => {
    await reset();
    // Refused at the limit: nothing stored; after a draft is gone, the same key succeeds.
    for (let i = 0; i < DRAFT_LIMIT; i++) await client(a.id).createQr(body(`Filler ${i}`));
    await expect(client(a.id).createQr(body("Later"), { idempotencyKey: "retryable-0001" })).rejects.toMatchObject({ status: 403 });
    expect((await counts(a.id)).keys).toBe(0);
    await pool.query("delete from qr_code where id = (select id from qr_code where user_id = $1 order by created_at limit 1)", [a.id]);
    const later = await client(a.id).createQr(body("Later"), { idempotencyKey: "retryable-0001" });
    expect((await counts(a.id)).keys).toBe(1);

    // A failure inside the transaction before anything is written (logo storage): nothing stored; retryable.
    await reset();
    const failing: PrepareRecord = async () => {
      throw new Error("storage unavailable");
    };
    await expect(createQrForOwner(db, a.id, body(), failing, "rollback-0001")).rejects.toThrow("storage unavailable");
    expect(await counts(a.id)).toEqual({ codes: 0, layouts: 0, keys: 0 });
    const after = await client(a.id).createQr(body(), { idempotencyKey: "rollback-0001" });
    expect(await counts(a.id)).toEqual({ codes: 1, layouts: 2, keys: 1 });
    expect(after.id).not.toBe(later.id);

    // A failure after the code and its layouts were written (storing the replay fails): the whole create rolls back.
    await reset();
    await pool.query("alter table api_idempotency_key add constraint hey165_fail_once check (key <> 'rollback-0002')");
    try {
      await expect(createQrForOwner(db, a.id, body(), undefined, "rollback-0002")).rejects.toThrow();
      expect(await counts(a.id)).toEqual({ codes: 0, layouts: 0, keys: 0 });
    } finally {
      await pool.query("alter table api_idempotency_key drop constraint hey165_fail_once");
    }
    const recovered = await client(a.id).createQr(body(), { idempotencyKey: "rollback-0002" });
    expect(await counts(a.id)).toEqual({ codes: 1, layouts: 2, keys: 1 });
    expect((await client(a.id).createQr(body(), { idempotencyKey: "rollback-0002" })).id).toBe(recovered.id);
  });

  it("after the 24-hour retention, the same key is a new create; without a key every create is new", async () => {
    await reset();
    const first = await client(a.id).createQr(body(), { idempotencyKey: "expiring-0001" });
    await pool.query("update api_idempotency_key set created_at = now() - interval '25 hours' where user_id = $1", [a.id]);
    const again = await client(a.id).createQr(body(), { idempotencyKey: "expiring-0001" });
    expect(again.id).not.toBe(first.id);
    expect(await counts(a.id)).toEqual({ codes: 2, layouts: 4, keys: 1 });
    expect((await pool.query("select qr_code_id from api_idempotency_key where user_id = $1", [a.id])).rows[0].qr_code_id).toBe(again.id);
    const [x, y] = [await client(a.id).createQr(body()), await client(a.id).createQr(body())];
    expect(x.id).not.toBe(y.id);
    expect((await counts(a.id)).codes).toBe(4);
  });

  it("every request is authenticated, replays included; a bad key header is refused before anything is stored", async () => {
    await reset();
    const created = await client(a.id).createQr(body(), { idempotencyKey: "auth-0001" });
    const replay = (authorization: string | null, key = "auth-0001") =>
      createRoute(
        new Request("http://localhost/api/v1/qr-codes", {
          method: "POST",
          headers: { ...(authorization ? { authorization } : {}), "idempotency-key": key },
          body: JSON.stringify(body()),
        }),
      );
    const revoked = await createApiKey(db, a.id);
    await revokeApiKey(db, a.id, revoked.id);
    for (const auth of [null, `Bearer ${revoked.key}`, "Bearer hqk_nope"]) {
      const res = await replay(auth);
      expect([res.status, res.headers.get("idempotent-replayed"), (await res.text()).includes(created.id)]).toEqual([401, null, false]);
    }
    const bad = await replay(`Bearer ${keys[a.id]}`, "has spaces in it");
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { details: { path: string }[] } }).error.details[0]?.path).toBe("Idempotency-Key");
    expect(await counts(a.id)).toEqual({ codes: 1, layouts: 2, keys: 1 });
  });
});

/*
 * Hosted pages (design 10.x / 11.x): draft vs published, the public short link, public files, cleanup, reports.
 */
describe.skipIf(!url)("hosted pages: drafts, publishing and public reads (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hp-owner", name: "Owner", email: "owner@hosted.test" };
  const other = { id: "hp-other", name: "Other", email: "other@hosted.test" };
  const objects = new Map<string, Uint8Array>();
  const store: LogoStore = {
    put: async (key, body) => void objects.set(key, body),
    get: async (key) => objects.get(key) ?? null,
    remove: async (key) => void objects.delete(key),
  };
  // A 1×1 PNG and a 1×1 JPEG (real headers; the server reads the type from the bytes).
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64")}`;
  const layout = designToLayout(DEFAULT_DESIGN);
  const prepare = (userId: string) => (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], c: HostedContent) =>
    storeHostedContent(tx, store, userId, c, newId);
  const save = (userId: string, content: unknown, model: "static" | "dynamic" = "dynamic", qrCodeId?: string) =>
    saveQrWithLayouts(
      db,
      userId,
      {
        ...(qrCodeId ? { qrCodeId } : {}),
        name: "Hosted",
        model,
        content: content as HostedContent,
        layouts: [{ name: "Default", layout }],
      },
      undefined,
      prepare(userId),
    );
  const activate = async (qrCodeId: string, shortCode: string) =>
    db.update(schema.qrCode).set({ status: "active", shortCode }).where(eq(schema.qrCode.id, qrCodeId));
  const link = async (code: string) => {
    const a = await resolveShortLink(db, code);
    return a.kind === "hosted" ? a : a.kind;
  };
  const menu = (name: string, photo: string | null = null): HostedContent => {
    const m = sampleHostedContent("menu");
    if (m.type !== "menu") throw new Error("menu");
    const first = m.sections[0];
    const dish = first?.dishes[0];
    if (!first || !dish) throw new Error("menu");
    return { ...m, name, sections: [{ ...first, dishes: [{ ...dish, photo }, ...first.dishes.slice(1)] }, ...m.sections.slice(1)] };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values([owner, other]).onConflictDoNothing();
    const day = 24 * 60 * 60 * 1000;
    await db
      .insert(schema.subscription)
      .values({
        id: "hp-sub",
        userId: owner.id,
        stripeSubscriptionId: "sub_hosted_test",
        stripePriceId: "price_x",
        status: "active",
        plan: "starter",
        activeCodeLimit: 5,
        currentPeriodStart: new Date(Date.now() - day),
        currentPeriodEnd: new Date(Date.now() + 30 * day),
      })
      .onConflictDoNothing();
  });
  afterAll(async () => {
    await pool.query("delete from qr_code where user_id = any($1)", [[owner.id, other.id]]);
    await pool.query("delete from asset where user_id = any($1)", [[owner.id, other.id]]);
    await pool.query("delete from subscription where id = 'hp-sub'");
    await pool.query("delete from developer_notify where email like '%@hosted.test'");
    await pool.end();
  });

  it("hosted types save only as Dynamic, in their stored shape, with photos moved to private storage", async () => {
    expect(await save(owner.id, menu("Static menu"), "static")).toEqual({ ok: false, error: "invalid" });
    expect(await save(owner.id, { ...menu("Bad"), extra: 1 })).toEqual({ ok: false, error: "invalid" });
    // A GIF (or any non JPG/PNG bytes) is refused even when it claims to be a PNG.
    expect(await save(owner.id, menu("Gif", `data:image/png;base64,${Buffer.from("GIF89a....").toString("base64")}`))).toEqual({
      ok: false,
      error: "invalid",
    });
    const saved = await save(owner.id, menu("Little Fern", PNG));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const row = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, saved.data.qrCodeId) });
    expect(row?.model).toBe("dynamic");
    expect(row?.destination).toBeNull();
    const photo = row?.content.type === "menu" ? row.content.sections[0]?.dishes[0]?.photo : null;
    expect(photo).toMatch(/^asset:/);
    expect([...objects.keys()].some((k) => k.startsWith(`hosted/${owner.id}/`))).toBe(true);
    // A saved hosted code can't turn into another type, nor a direct code.
    expect(await save(owner.id, sampleHostedContent("coupon"), "dynamic", saved.data.qrCodeId)).toEqual({ ok: false, error: "invalid" });
    // Another account can't use the owner's stored file.
    expect(await save(other.id, menu("Stolen", photo ?? ""))).toEqual({ ok: false, error: "invalid" });
  });

  it("visitors see only the latest published version; drafts, refused publishes and edits stay private", async () => {
    const saved = await save(owner.id, menu("Version one", JPEG));
    if (!saved.ok) throw new Error("save");
    const id = saved.data.qrCodeId;
    await activate(id, "hpmenu1");
    // Never published: the live short link has nothing to show.
    expect(await link("hpmenu1")).toBe("unavailable");
    expect(await publishHosted(db, other.id, id)).toEqual({ ok: false, error: "not_found" });
    const v1 = await publishHosted(db, owner.id, id);
    expect(v1).toMatchObject({ ok: true, version: 1, unchanged: false });
    const first = await link("hpmenu1");
    expect(typeof first === "object" && first.page.content.type === "menu" && first.page.content.name).toBe("Version one");

    // Scans before the edit, on the same code.
    await incrementScan(db, id);
    // The owner edits the draft: the public page doesn't change.
    const draft = await saveHostedDraft(db, store, owner.id, id, menu("Version two (draft)"), newId);
    expect(draft.ok).toBe(true);
    const still = await link("hpmenu1");
    expect(typeof still === "object" && still.page.content.type === "menu" && still.page.content.name).toBe("Version one");
    expect(
      (await hostedStatus(db, { id, content: (await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, id) }))?.content })).changed,
    ).toBe(true);

    // A draft that breaks the rules is refused; the live version stays.
    await saveHostedDraft(db, store, owner.id, id, { ...menu(""), name: "" }, newId);
    const refused = await publishHosted(db, owner.id, id);
    expect(refused).toMatchObject({ ok: false, error: "invalid", errors: { name: "menuName" } });
    expect((await link("hpmenu1")) !== "unavailable").toBe(true);

    // Fixed and republished: version 2 on the same QR, short link and scan history.
    await saveHostedDraft(db, store, owner.id, id, menu("Version two"), newId);
    expect(await publishHosted(db, owner.id, id)).toMatchObject({ ok: true, version: 2 });
    expect(await publishHosted(db, owner.id, id)).toMatchObject({ ok: true, version: 2, unchanged: true });
    const second = await link("hpmenu1");
    expect(typeof second === "object" && second.qrCodeId === id && second.page.content.type === "menu" && second.page.content.name).toBe(
      "Version two",
    );
    const code = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, id) });
    expect(code?.shortCode).toBe("hpmenu1");
    expect(await hasScans(db, owner.id, id)).toBe(true);

    // Paused: unavailable, and its files too.
    await db.update(schema.qrCode).set({ status: "paused" }).where(eq(schema.qrCode.id, id));
    expect(await link("hpmenu1")).toBe("unavailable");
  });

  it("public files: only those of the live published version, of the code's owner", async () => {
    const saved = await save(owner.id, menu("Files", PNG));
    if (!saved.ok) throw new Error("save");
    const id = saved.data.qrCodeId;
    await activate(id, "hpfile1");
    const row = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, id) });
    const published = row?.content.type === "menu" ? row.content.sections[0]?.dishes[0]?.photo?.slice(6) : undefined;
    if (!published) throw new Error("photo");
    // Before publishing, the stored photo is a draft file: not public.
    expect(await publicHostedFile(db, store, "hpfile1", published)).toBeNull();
    await publishHosted(db, owner.id, id);
    expect((await publicHostedFile(db, store, "hpfile1", published))?.contentType).toBe("image/png");
    // A new draft photo isn't public until published; the published one stays readable meanwhile.
    await saveHostedDraft(db, store, owner.id, id, menu("Files", JPEG), newId);
    const draftRow = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, id) });
    const draftPhoto = draftRow?.content.type === "menu" ? draftRow.content.sections[0]?.dishes[0]?.photo?.slice(6) : undefined;
    if (!draftPhoto) throw new Error("draft photo");
    expect(await publicHostedFile(db, store, "hpfile1", draftPhoto)).toBeNull();
    expect(await publicHostedFile(db, store, "hpfile1", published)).not.toBeNull();
    // Another account's file id, through this code: never.
    const foreign = await save(other.id, menu("Other", JPEG));
    if (!foreign.ok) throw new Error("foreign");
    const foreignRow = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.id, foreign.data.qrCodeId) });
    const foreignPhoto = foreignRow?.content.type === "menu" ? foreignRow.content.sections[0]?.dishes[0]?.photo?.slice(6) : undefined;
    expect(await publicHostedFile(db, store, "hpfile1", foreignPhoto ?? "x")).toBeNull();
    // Cleanup keeps files referenced by drafts and published versions.
    await pool.query("update asset set last_used_at = now() - interval '3 days' where user_id = $1", [owner.id]);
    await cleanupLogos(db, store);
    expect(await publicHostedFile(db, store, "hpfile1", published)).not.toBeNull();
    expect(await db.query.asset.findFirst({ where: eq(schema.asset.id, draftPhoto) })).toBeDefined();
  });

  it("PDF: server checks, owner-only references, and the published file stays while a replacement is pending", async () => {
    expect(checkPdf(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(checkPdf(new TextEncoder().encode("hello"))).toEqual({ ok: false, reason: "notPdf" });
    const sample = new Uint8Array(
      readFileSync(fileURLToPath(new URL("../../../public/samples/spring-class-schedule.pdf", import.meta.url))),
    );
    expect(checkPdf(sample)).toEqual({ ok: true, pages: 2 });
    const assetId = await storePdf(db, store, owner.id, sample, newId);
    const pdf = {
      ...emptyHostedContent("pdf"),
      title: "Schedule",
      file: { asset: `asset:${assetId}`, name: "schedule.pdf", bytes: sample.byteLength, pages: 2 },
    } as HostedContent;
    // Not the other account's to use.
    expect(await save(other.id, pdf)).toEqual({ ok: false, error: "invalid" });
    const saved = await save(owner.id, pdf);
    if (!saved.ok) throw new Error("save");
    await activate(saved.data.qrCodeId, "hppdf01");
    await publishHosted(db, owner.id, saved.data.qrCodeId);
    expect((await publicHostedFile(db, store, "hppdf01", assetId))?.contentType).toBe("application/pdf");
    // The owner removes the file in the draft (replacement still uploading): the live PDF is still served.
    await saveHostedDraft(db, store, owner.id, saved.data.qrCodeId, { ...pdf, file: null }, newId);
    expect(await publishHosted(db, owner.id, saved.data.qrCodeId)).toMatchObject({
      ok: false,
      error: "invalid",
      errors: { file: "pdfFile" },
    });
    expect(await publicHostedFile(db, store, "hppdf01", assetId)).not.toBeNull();
  });

  it("coupon: the end date is valid through that day in the owner's time zone; expired pages hide code and link", async () => {
    const coupon = { ...sampleHostedContent("coupon"), expires: "2026-11-30", timeZone: "America/Los_Angeles" } as HostedContent;
    if (coupon.type !== "coupon") throw new Error("coupon");
    // 2026-12-01 07:59 UTC is still Nov 30 in Los Angeles; 08:00 UTC is Dec 1 there.
    const lastMinute = publicHostedContent(coupon, "x", new Date("2026-12-01T07:59:00Z"));
    const ended = publicHostedContent(coupon, "x", new Date("2026-12-01T08:00:00Z"));
    expect(lastMinute.type === "coupon" && [lastMinute.code, lastMinute.link]).toEqual([coupon.code, coupon.link]);
    expect(ended.type === "coupon" && [ended.code, ended.link, ended.terms]).toEqual(["", "", coupon.terms]);
  });

  it("hosted codes have no destination: Change destination and Make it static are refused", async () => {
    const saved = await save(owner.id, sampleHostedContent("social"));
    if (!saved.ok) throw new Error("save");
    expect(await changeFresh(db, owner.id, saved.data.qrCodeId, "https://example.com")).toMatchObject({ ok: false, error: "not_found" });
    expect(await convertToStatic(db, owner.id, saved.data.qrCodeId)).toEqual({ ok: false });
  });

  it("reports are stored for existing links and limited per visitor; notify sign-ups are de-duplicated", async () => {
    expect(await submitReport(db, { code: "nope-nope", reason: "scam" }, "r1")).toEqual({ ok: false, error: "not_found" });
    expect(await submitReport(db, { code: "hpmenu1", reason: "bogus" }, "r1")).toEqual({ ok: false, error: "invalid" });
    for (let i = 0; i < REPORTS_PER_HOUR; i++)
      expect(await submitReport(db, { code: "hpmenu1", reason: "scam", details: `#${i}` }, "r-limit")).toEqual({ ok: true });
    expect(await submitReport(db, { code: "hpmenu1", reason: "scam" }, "r-limit")).toEqual({ ok: false, error: "rate_limited" });
    expect((await reportsFor(db, "hpmenu1")).length).toBe(REPORTS_PER_HOUR);
    expect(await submitDeveloperNotify(db, { email: "Dev@hosted.test", topic: "packages" })).toEqual({ ok: true });
    expect(await submitDeveloperNotify(db, { email: "dev@hosted.test", topic: "packages" })).toEqual({ ok: true });
    expect(await submitDeveloperNotify(db, { email: "not an email", topic: "packages" })).toEqual({ ok: false, error: "invalid" });
    expect(Number((await pool.query("select count(*)::int as n from developer_notify where email = 'dev@hosted.test'")).rows[0].n)).toBe(1);
  });
});

/* HEY-178: the public API's budgets per account, through the real routes, SDK and PostgreSQL counters. */
describe.skipIf(!url)("public API rate limit (HEY-178, real PostgreSQL)", () => {
  let pool: Pool;
  /** A second app instance: its own pool. */
  let pool2: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let db2: ReturnType<typeof drizzle<typeof schema>>;
  type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
  let create: Handler;
  let layoutRoute: { GET: Handler; PATCH: Handler };
  let destinationRoute: { GET: Handler; PATCH: Handler };
  const a = { id: "rl178-a", name: "A", email: "a@rl178.test" };
  const b = { id: "rl178-b", name: "B", email: "b@rl178.test" };
  let keys: string[] = [];
  let keyB = "";
  const LIMIT = 6;
  const T0 = new Date("2026-11-25T12:00:00.000Z");
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
  const body = {
    name: "Menu",
    mode: "static",
    content: { type: "website", url: "littlefern.cafe" },
    layouts: [{ name: "A", layout: designToLayout(DEFAULT_DESIGN) }],
  };
  const post = (key: string, extra: Record<string, string> = {}, raw: unknown = body) =>
    create(
      new Request("http://localhost/api/v1/qr-codes", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, ...extra },
        body: JSON.stringify(raw),
      }),
    );
  const stored = async (user: string) =>
    (
      await pool.query(
        `select (select count(*)::int from qr_code where user_id = $1) as codes,
                (select count(*)::int from api_idempotency_key where user_id = $1) as keys,
                (select coalesce(string_agg(destination || destination_revision, ','), '') from qr_code where user_id = $1) as destinations,
                (select coalesce(string_agg(l.name || l.updated_at, ','), '') from qr_layout l join qr_code q on q.id = l.qr_code_id where q.user_id = $1) as layouts`,
        [user],
      )
    ).rows[0] as { codes: number; keys: number; destinations: string; layouts: string };
  const saturate = async () => {
    while ((await takeRequest(db, a.id, "api")).ok);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 8 });
    pool2 = new Pool({ connectionString: url, max: 8 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    db2 = drizzle(pool2, { schema, casing: "snake_case" });
    apiDb.current = db;
    vi.stubEnv("API_RATE_LIMIT_PER_MINUTE", String(LIMIT));
    vi.stubEnv("API_RATE_LIMIT_EXPORTS_PER_MINUTE", "2");
    await db.insert(schema.user).values([a, b]);
    keys = [(await createApiKey(db, a.id)).key, (await createApiKey(db, a.id)).key];
    keyB = (await createApiKey(db, b.id)).key;
    create = (await import("../../app/api/v1/qr-codes/route")).POST as Handler;
    layoutRoute = (await import("../../app/api/v1/qr-codes/[qrCodeId]/layouts/[layoutId]/route")) as unknown as typeof layoutRoute;
    destinationRoute = (await import("../../app/api/v1/qr-codes/[qrCodeId]/destination/route")) as unknown as typeof destinationRoute;
  });
  const fresh = async () => {
    limiterClock.now = T0;
    limiterClock.timeoutMs = undefined;
    await pool.query("delete from api_rate_limit");
    await pool.query("delete from qr_code where user_id in ($1, $2)", [a.id, b.id]);
  };
  afterAll(async () => {
    vi.unstubAllEnvs();
    limiterClock.now = undefined;
    limiterClock.timeoutMs = undefined;
    await db?.delete(schema.user).where(inArray(schema.user.id, [a.id, b.id]));
    await pool?.end();
    await pool2?.end();
  });

  it("a concurrent burst over two keys stays within one account's budget; a second account is independent", async () => {
    await fresh();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post(keys[i % 2] ?? "", { "idempotency-key": `burst-${i}` })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20 - LIMIT);
    expect(await stored(a.id)).toMatchObject({ codes: LIMIT, keys: LIMIT });
    expect((await post(keyB)).status).toBe(201);
  });

  it("the counter is atomic across two instances' connections", async () => {
    await fresh();
    const taken = await Promise.all(Array.from({ length: 40 }, (_, i) => takeRequest(i % 2 ? db : db2, a.id, "api", { now: T0 })));
    expect(taken.filter((t) => t.ok)).toHaveLength(LIMIT);
  });

  it("429: code, limit, Retry-After and no-store; the wait counts down, isn't extended by retries, and then requests resume", async () => {
    await fresh();
    await saturate();
    for (const [elapsed, wait] of [
      [0, 60],
      [42.5, 18],
      [59.9, 1],
    ] as const) {
      limiterClock.now = at(elapsed);
      for (const key of keys) {
        const res = await post(key);
        expect([res.status, res.headers.get("retry-after"), res.headers.get("cache-control")]).toEqual([429, String(wait), "no-store"]);
        expect(((await res.json()) as { error: object }).error).toMatchObject({ code: "rate_limited", limit: "api" });
      }
    }
    limiterClock.now = at(WINDOW_SECONDS);
    expect((await post(keys[0] ?? "")).status).toBe(201);
    expect((await post(keys[1] ?? "")).status).toBe(201);
  });

  it("the SDK exposes the code and Retry-After, and the same create succeeds after the wait", async () => {
    await fresh();
    const client = new HeyQrClient({
      apiKey: keys[0] ?? "",
      baseUrl: "http://localhost",
      fetch: (async (u: string, init: RequestInit) => create(new Request(u, init))) as unknown as FetchLike,
    });
    await saturate();
    limiterClock.now = at(43);
    const options = { idempotencyKey: "sdk-178" };
    const error: unknown = await client.createQr(body as Sdk.CreateQrRequest, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeyQrRateLimitError);
    expect(error).toMatchObject({ status: 429, kind: "rate_limited", code: "rate_limited", retryAfterSeconds: 17 });
    expect(await stored(a.id)).toMatchObject({ codes: 0, keys: 0 });
    limiterClock.now = at(43 + 17);
    expect((await client.createQr(body as Sdk.CreateQrRequest, options)).status).toBe("draft");
  });

  it("a refused create, layout update or destination update changes nothing; reads are refused too", async () => {
    await fresh();
    const made = (await (await post(keys[0] ?? "", {}, { ...body, mode: "dynamic" })).json()) as { id: string; layouts: { id: string }[] };
    const params = { params: Promise.resolve({ qrCodeId: made.id, layoutId: made.layouts[0]?.id }) };
    const send = (handler: Handler, method: string, payload?: unknown) =>
      handler(
        new Request("http://localhost/x", {
          method,
          headers: { authorization: `Bearer ${keys[1]}` },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        }),
        params,
      );
    const { revision } = (await (await send(layoutRoute.GET, "GET")).json()) as { revision: string };
    const destination = { destination: "https://littlefern.cafe/new", revision: 0 };
    const layout = { revision, name: "Renamed" };
    await saturate();
    const before = await stored(a.id);
    const answers = [
      await post(keys[1] ?? "", { "idempotency-key": "refused-178" }),
      await send(layoutRoute.PATCH, "PATCH", layout),
      await send(destinationRoute.PATCH, "PATCH", destination),
      await send(layoutRoute.GET, "GET"),
      await send(destinationRoute.GET, "GET"),
    ];
    expect(answers.map((r) => r.status)).toEqual([429, 429, 429, 429, 429]);
    expect(await stored(a.id)).toEqual(before);
    // The same updates, from the same revisions, apply once the window has passed.
    limiterClock.now = at(WINDOW_SECONDS);
    expect((await send(layoutRoute.PATCH, "PATCH", layout)).status).toBe(200);
    expect((await send(destinationRoute.PATCH, "PATCH", destination)).status).toBe(200);
  });

  it("exports have their own budget inside the account's", async () => {
    await fresh();
    const exports = [];
    for (let i = 0; i < 3; i++) exports.push((await takeRequest(db, a.id, "export", { now: T0 })).ok);
    expect(exports).toEqual([true, true, false]);
    expect((await takeRequest(db, a.id, "api", { now: T0 })).ok).toBe(true);
  });

  it("invalid and revoked keys stay 401 and spend nothing, saturated or not", async () => {
    await fresh();
    const extra = await createApiKey(db, a.id);
    await revokeApiKey(db, a.id, extra.id);
    const bad = ["hqk_nope", generateApiKey().key, extra.key];
    for (const key of bad) expect((await post(key)).status).toBe(401);
    expect(Number((await pool.query("select count(*)::int as n from api_rate_limit")).rows[0].n)).toBe(0);
    await saturate();
    for (const key of bad) {
      const res = await post(key);
      expect([res.status, res.headers.get("retry-after")]).toEqual([401, null]);
    }
  });

  it("while the owner's API budget is spent, short links resolve and count scans, and webhooks are fulfilled", async () => {
    await fresh();
    await db.insert(schema.qrCode).values({
      id: "rl178-q",
      userId: a.id,
      name: "Q",
      model: "dynamic",
      status: "active",
      content: { type: "website", url: "https://x.example" },
      shortCode: "RL178qq",
      destination: "https://x.example/now",
    });
    await db
      .insert(schema.subscription)
      .values({ id: "rl178-s", userId: a.id, stripeSubscriptionId: "sub_rl178", stripePriceId: "p", status: "active", activeCodeLimit: 5 });
    await db.insert(schema.purchase).values({
      id: "rl178-o",
      userId: a.id,
      item: "pack3",
      lines: [{ offer: "pack3", amount: 1199 }],
      stripeCheckoutSessionId: "cs_rl178",
      amountTotal: 1199,
      currency: "usd",
    });
    await saturate();
    expect((await post(keys[0] ?? "")).status).toBe(429);
    for (let i = 0; i < LIMIT * 2; i++) {
      expect(await resolveShortLink(db, "RL178qq")).toMatchObject({ kind: "redirect", to: "https://x.example/now" });
      await incrementScan(db, "rl178-q");
    }
    expect((await scansByDay(db, a.id, "rl178-q")).reduce((n, d) => n + d.count, 0)).toBe(LIMIT * 2);
    const done = await processCheckoutEvent(
      db,
      {
        id: "evt_rl178",
        type: "checkout.session.completed",
        session: {
          id: "cs_rl178",
          mode: "payment",
          status: "complete",
          payment_status: "paid",
          payment_intent: "pi_rl178",
          amount_subtotal: 1199,
          amount_total: 1199,
          total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
          currency: "usd",
          metadata: { userId: a.id },
        },
      },
      () => "unused",
    );
    expect(done).toMatchObject({ duplicate: false, result: { granted: true } });
    expect(await creditBalance(db, a.id)).toBe(3);
  });

  it("limiter store failing or not answering: 500 internal_error, nothing done, keys still checked first, nothing secret logged", async () => {
    await fresh();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const refused = async () => {
      const res = await post(keys[0] ?? "", { "idempotency-key": "down-178" });
      expect([res.status, res.headers.get("retry-after")]).toEqual([500, "5"]);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("internal_error");
      expect((await post("hqk_nope")).status).toBe(401);
      expect(await stored(a.id)).toMatchObject({ codes: 0, keys: 0 });
    };
    try {
      await pool.query("alter table api_rate_limit rename to api_rate_limit_away");
      await refused();
    } finally {
      await pool.query("alter table api_rate_limit_away rename to api_rate_limit");
    }
    // Not answering: another session holds the account's row.
    await takeRequest(db, a.id, "api");
    const holder = await pool2.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from api_rate_limit where user_id = $1 for update", [a.id]);
      limiterClock.timeoutMs = 150;
      await refused();
    } finally {
      await holder.query("rollback");
      holder.release();
    }
    const logged = JSON.stringify(error.mock.calls);
    error.mockRestore();
    expect(logged).toContain("api.rate_limit");
    for (const key of keys) expect(logged).not.toContain(key.slice(17));
    limiterClock.timeoutMs = undefined;
    expect((await post(keys[0] ?? "")).status).toBe(201);
  });
});
