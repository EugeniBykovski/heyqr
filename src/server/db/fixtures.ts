import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DEFAULT_DESIGN, designToLayout } from "../../entities/qr/model/design";
import * as schema from "./schema";

/** Synthetic demo data. Every row has a fixed `seed-` id, so reruns insert nothing new and never touch other rows. */
export const SEED_USER = { id: "seed-user", name: "Ana Reyes", email: "ana@example.com" } as const;
export const SEED_SCAN_DAYS = 14;

export async function seedFixtures(db: NodePgDatabase<typeof schema>) {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.user)
      .values({ ...SEED_USER, emailVerified: true })
      .onConflictDoNothing();
    const owner = await tx.query.user.findFirst({ where: (u, { eq }) => eq(u.email, SEED_USER.email), columns: { id: true } });
    if (owner?.id !== SEED_USER.id) {
      throw new Error(`Refusing to seed: ${SEED_USER.email} already belongs to another account. Use a fresh database or remove that user.`);
    }

    await tx
      .insert(schema.qrCode)
      .values([
        {
          id: "seed-static",
          userId: SEED_USER.id,
          name: "Portfolio card",
          content: { type: "website", url: "https://anareyes.studio/portfolio" },
          status: "active",
          purchasedAt: new Date("2026-01-15T10:00:00Z"),
        },
        {
          id: "seed-dynamic",
          userId: SEED_USER.id,
          name: "Café menu",
          model: "dynamic",
          status: "active",
          content: { type: "website", url: "https://littlefern.cafe/menu" },
          shortCode: "fernmnu",
          destination: "https://littlefern.cafe/menu",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(schema.qrLayout)
      .values([
        {
          id: "seed-static-l1",
          qrCodeId: "seed-static",
          name: "Portfolio card",
          design: {
            layout: designToLayout({
              ...DEFAULT_DESIGN,
              pattern: "dot",
              fg: "#24137A",
              preset: "frame",
              frameStyle: "bar",
              caption: "View portfolio",
            }),
          },
        },
        {
          id: "seed-dynamic-l1",
          qrCodeId: "seed-dynamic",
          name: "Table tent",
          design: { layout: designToLayout({ ...DEFAULT_DESIGN, fg: "#1D4743" }) },
        },
      ])
      .onConflictDoNothing();

    // Scans for the last two weeks so the chart has data; one row per day, so a rerun on the same day adds nothing.
    const today = Date.now();
    await tx
      .insert(schema.scanDaily)
      .values(
        Array.from({ length: SEED_SCAN_DAYS }, (_, i) => ({
          qrCodeId: "seed-dynamic",
          day: new Date(today - i * 86_400_000).toISOString().slice(0, 10),
          count: 8 + ((i * 7) % 23),
        })),
      )
      .onConflictDoNothing();
  });
}
