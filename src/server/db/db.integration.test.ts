/**
 * Real-Postgres checks for migrations, seeding and the health check.
 * Runs when TEST_DATABASE_URL points at a database whose name ends in "_test" (CI, `pnpm test:db`); skipped otherwise.
 * The test drops and recreates that database's schema, so it never runs against anything else.
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "../../entities/qr/model/design";
import { designSettingsOf, readLayoutRecord } from "../../entities/qr/model/design-schema";
import { RESTORE_WINDOW_MS, restoreQrCodes, softDeleteQrCodes } from "../qr/delete-qr";
import { renameQrCode } from "../qr/rename-qr";
import { saveQrWithLayouts } from "../qr/save-qr";
import { addLayoutFrom, removeLayout, updateLayoutDesign } from "../qr/update-layout";
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
    expect(result).toEqual({ ok: true, data: { qrCodeId, layoutId: layoutIds[0] } });

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
