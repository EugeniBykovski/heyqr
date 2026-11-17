/**
 * Local development data: one user with a static (bought) and a dynamic code with scans.
 * Run with `pnpm db:seed` after `pnpm db:migrate`. Never run against production.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { designToLayout, DEFAULT_DESIGN } from "../../entities/qr/model/design";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url || /neon\.tech|amazonaws/.test(url)) throw new Error("Refusing to seed: DATABASE_URL is missing or looks like a hosted database.");

const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema, casing: "snake_case" });

const userId = "seed-user";
await db.insert(schema.user).values({ id: userId, name: "Ana Reyes", email: "ana@example.com", emailVerified: true }).onConflictDoNothing();

const staticLayout = designToLayout({
  ...DEFAULT_DESIGN,
  pattern: "dot",
  fg: "#24137A",
  preset: "frame",
  frameStyle: "bar",
  caption: "View portfolio",
});
await db
  .insert(schema.qrCode)
  .values({
    id: "seed-static",
    userId,
    name: "Portfolio card",
    content: { type: "website", url: "https://anareyes.studio/portfolio" },
    status: "active",
    purchasedAt: new Date(),
  })
  .onConflictDoNothing();
await db
  .insert(schema.qrLayout)
  .values({ id: "seed-static-l1", qrCodeId: "seed-static", name: "Portfolio card", design: { layout: staticLayout } })
  .onConflictDoNothing();

await db
  .insert(schema.qrCode)
  .values({
    id: "seed-dynamic",
    userId,
    name: "Café menu",
    model: "dynamic",
    status: "active",
    content: { type: "website", url: "https://littlefern.cafe/menu" },
    shortCode: "fernmnu",
    destination: "https://littlefern.cafe/menu",
  })
  .onConflictDoNothing();
await db
  .insert(schema.qrLayout)
  .values({
    id: "seed-dynamic-l1",
    qrCodeId: "seed-dynamic",
    name: "Table tent",
    design: { layout: designToLayout({ ...DEFAULT_DESIGN, fg: "#1D4743" }) },
  })
  .onConflictDoNothing();
for (let i = 0; i < 14; i++) {
  const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
  await db
    .insert(schema.scanDaily)
    .values({ qrCodeId: "seed-dynamic", day, count: 8 + ((i * 7) % 23) })
    .onConflictDoNothing();
}

console.log("Seeded user ana@example.com with 2 codes.");
await pool.end();
