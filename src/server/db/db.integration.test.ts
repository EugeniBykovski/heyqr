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
import { saveQrWithLayouts } from "../qr/save-qr";
import { addLayoutFrom, updateLayoutDesign } from "../qr/update-layout";
import { checkDatabase, EXPECTED_MIGRATIONS, REQUIRED_TABLES } from "./check";
import { SEED_SCAN_DAYS, seedFixtures } from "./fixtures";
import { runMigrations } from "./migrator";
import * as schema from "./schema";
import { assertAllowed } from "./target";

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
