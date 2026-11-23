/**
 * Real-Postgres checks for migrations, seeding and the health check.
 * Runs when TEST_DATABASE_URL points at a database whose name ends in "_test" (CI, `pnpm test:db`); skipped otherwise.
 * The test drops and recreates that database's schema, so it never runs against anything else.
 */
import { and, eq, inArray } from "drizzle-orm";
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
import { changeDestination } from "../qr/destination";
import { assignShortCode, SHORT_CODE_ATTEMPTS, ShortCodeExhaustedError } from "../qr/short-code";
import { saveQrWithLayouts } from "../qr/save-qr";
import { addLayoutFrom, copyLayout, layoutRevision, removeLayout, updateLayoutDesign, type PrepareRecord } from "../qr/update-layout";
import { activateTrialCode, startTrial, trialCode } from "../billing/trial";
import {
  accountUsage,
  activateDynamicCode,
  applyPrintPackAllowance,
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
import { DRAFT_LIMIT } from "../../shared/config/catalog-core";

const url = process.env.TEST_DATABASE_URL;

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
  const owner = { id: "slug-owner", name: "Owner", email: "owner@slug.test" };
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
    expect(await changeDestination(db, owner.id, id, "https://menu.example.test/third")).toMatchObject({
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

    expect(await changeDestination(db, owner.id, id, "http://plain.example.test/menu?table=4&lang=en#drinks")).toMatchObject({
      ok: true,
      data: { destination: "http://plain.example.test/menu?table=4&lang=en#drinks" },
    });
    expect(await changeDestination(db, owner.id, id, "secure.example.test/menu?table=5#food")).toMatchObject({
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
      expect(await changeDestination(db, owner.id, id, bad)).toMatchObject({ ok: false, error: "invalid", field: "destination" });
    expect(await changeDestination(db, other.id, id, "https://other.example.test")).toEqual({ ok: false, error: "not_found" });
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
    expect(await changeDestination(db, owner.id, saved.data.qrCodeId, "https://new.example.test")).toEqual({
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
      shortCode: "chg0001",
    });
    const [{ now: before }] = (await pool.query("select now() as now")).rows as { now: Date }[];
    const first = await changeDestination(db, owner.id, id, "https://second.example.test/menu?x=1#y");
    if (!first.ok) throw new Error("change failed");
    expect(first.data).toMatchObject({
      destination: "https://second.example.test/menu?x=1#y",
      previousDestination: "https://first.example.test/menu",
    });
    expect(new Date(first.data.changedAt ?? 0).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await reload(id)).toEqual({ ...first.data, shortCode: "chg0001" });

    // The next change keeps only the most recent one (full history is HEY-125).
    const second = await changeDestination(db, owner.id, id, "http://third.example.test/");
    if (!second.ok) throw new Error("change failed");
    expect(second.data.previousDestination).toBe("https://second.example.test/menu?x=1#y");
    expect(new Date(second.data.changedAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(first.data.changedAt ?? 0).getTime());
    expect(await reload(id)).toEqual({ ...second.data, shortCode: "chg0001" });
  });

  it("the same URL, invalid input and another account leave the previous URL and time intact", async () => {
    const id = await live("chg0002");
    const changed = await changeDestination(db, owner.id, id, "https://second.example.test/");
    if (!changed.ok) throw new Error("change failed");
    const stored = await reload(id);
    // The same address (also typed as a bare domain): nothing written, the stored change returned as it was.
    expect(await changeDestination(db, owner.id, id, "https://second.example.test/")).toEqual({ ok: true, data: changed.data });
    expect(await changeDestination(db, owner.id, id, "second.example.test/")).toEqual({ ok: true, data: changed.data });
    for (const bad of ["ftp://files.example.test", "not a url", ""])
      expect(await changeDestination(db, owner.id, id, bad)).toMatchObject({ ok: false, error: "invalid", field: "destination" });
    expect(await changeDestination(db, other.id, id, "https://other.example.test")).toEqual({ ok: false, error: "not_found" });
    expect(await reload(id)).toEqual(stored);
  });

  it("an older row with a previous URL but no time keeps the URL; the next actual change records a time", async () => {
    const id = await live("chg0003");
    await db.update(schema.qrCode).set({ previousDestination: "https://legacy.example.test/" }).where(eq(schema.qrCode.id, id));
    expect(await changeDestination(db, owner.id, id, "https://first.example.test/menu")).toEqual({
      ok: true,
      data: { destination: "https://first.example.test/menu", previousDestination: "https://legacy.example.test/", changedAt: null },
    });
    const next = await changeDestination(db, owner.id, id, "https://new.example.test/");
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
    const changed = await changeDestination(db, owner.id, qrCodeId, "http://second.example.test/menu?x=1#y");
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
    expect((await changeDestination(db, owner.id, qrCodeId, "https://third.example.test/")).ok).toBe(true);
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
