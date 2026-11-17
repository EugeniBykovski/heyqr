import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  // drizzle-kit (generate, studio) uses the direct connection when there is one; apply migrations with `pnpm db:migrate`.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "postgres://heyqr:heyqr@localhost:5432/heyqr" },
  strict: true,
  verbose: true,
});
