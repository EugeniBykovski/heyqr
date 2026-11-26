/**
 * HEY-182 moderation, for operators (design 11.0 "Report this page → moderation queue → Unavailable").
 *
 *   pnpm moderation queue                       reported short links not taken down, most reports first
 *   pnpm moderation reports <shortCode>         every report of one short link
 *   pnpm moderation take-down <shortCode> <reason>   reason: scam | malware | illegal | impersonation | other
 *   pnpm moderation restore <shortCode>
 *
 * Uses DATABASE_URL like the app (the environment from APP_ENV). Prints the database it acts on, never credentials.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { describeDatabaseUrl, resolveDbTarget, runtimeUrl } from "../src/server/db/target";
import { reportsFor } from "../src/server/qr/hosted-public";
import { moderationQueue, restoreTakenDown, takeDown } from "../src/server/qr/moderation";

const [command, shortCode, reason] = process.argv.slice(2);
const url = runtimeUrl();
const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool, { schema, casing: "snake_case" });

async function main() {
  console.log(`Moderation on the ${resolveDbTarget()} database ${describeDatabaseUrl(url)}`);
  switch (command) {
    case "queue": {
      const rows = await moderationQueue(db);
      if (!rows.length) console.log("No open reports.");
      for (const r of rows)
        console.log(`${r.shortCode}\t${r.reports} report(s)\t${r.reasons.join(", ")}\tlatest ${r.latest?.toISOString()}`);
      return;
    }
    case "reports": {
      if (!shortCode) throw new Error("Usage: pnpm moderation reports <shortCode>");
      for (const r of await reportsFor(db, shortCode))
        console.log(
          `${r.createdAt.toISOString()}\t${r.reason}\tversion ${r.version ?? "-"}\t${r.details.replace(/\s+/g, " ").slice(0, 200)}`,
        );
      return;
    }
    case "take-down": {
      if (!shortCode || !reason) throw new Error("Usage: pnpm moderation take-down <shortCode> <reason>");
      const r = await takeDown(db, shortCode, reason);
      if (!r.ok) throw new Error(r.error === "not_found" ? `No code with the short link ${shortCode}.` : `Unknown reason “${reason}”.`);
      console.log(
        r.already ? `${shortCode} was already taken down.` : `${shortCode} is taken down: its page and link answer “unavailable”.`,
      );
      return;
    }
    case "restore": {
      if (!shortCode) throw new Error("Usage: pnpm moderation restore <shortCode>");
      const r = await restoreTakenDown(db, shortCode);
      console.log(r.ok ? `${shortCode} is restored.` : `${shortCode} wasn't taken down.`);
      return;
    }
    default:
      throw new Error("Usage: pnpm moderation queue | reports <shortCode> | take-down <shortCode> <reason> | restore <shortCode>");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
