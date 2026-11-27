import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "../../entities/qr/model/design";
import { designSettingsOf } from "../../entities/qr/model/design-schema";
import { saveQrWithLayouts } from "../qr/save-qr";
import * as schema from "./schema";

/*
 * HEY-193: the app's save path (Export, guest sign-in, edits) refuses an event whose date or times can't make a correct
 * calendar entry, and writes nothing; unfinished drafts still save.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("event drafts on save (HEY-193, real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const owner = { id: "hey193-owner", name: "Owner", email: "owner@hey193.test" };
  const layouts = [{ name: "Poster", layout: designToLayout(DEFAULT_DESIGN), editor: designSettingsOf(DEFAULT_DESIGN) }];
  const count = async () => Number((await pool.query("select count(*)::int as n from qr_code where user_id = $1", [owner.id])).rows[0].n);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    db = drizzle(pool, { schema, casing: "snake_case" });
    await db.insert(schema.user).values(owner).onConflictDoNothing();
  });
  afterAll(async () => {
    await db?.delete(schema.user).where(eq(schema.user.id, owner.id));
    await pool?.end();
  });

  it("saves a valid or unfinished event, refuses an impossible date or a reversed time and writes nothing", async () => {
    const before = await count();
    const save = (content: Record<string, unknown>) =>
      saveQrWithLayouts(db, owner.id, {
        name: "Spring show",
        model: "static",
        content: { type: "event", title: "Spring show", ...content } as never,
        layouts,
      });
    for (const bad of [
      { start: "2026-02-30" },
      { start: "2026-12-05T19:00", end: "2026-12-05T18:00" },
      { start: "2026-12-05", end: "2026-12-05T18:00" },
      { start: "", end: "2026-12-05T18:00" },
    ])
      expect(await save(bad), JSON.stringify(bad)).toEqual({ ok: false, error: "invalid" });
    expect(await count()).toBe(before);
    expect((await save({ start: "2026-12-05T19:00", end: "2026-12-05T21:30", place: "Reyes Studio, 21 Pier St" })).ok).toBe(true);
    expect((await save({ start: "" })).ok).toBe(true); // an unfinished draft
    expect(await count()).toBe(before + 2);
  });
});
