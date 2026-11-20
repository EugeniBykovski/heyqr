import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { APP_ENVS, resolveAppEnv } from "@/shared/config/app-env";
import { environmentProblems } from "@/shared/config/env-rules";

/*
 * Typed, validated environment (see docs/ENVIRONMENTS.md).
 * - server: read on the server only; @t3-oss/env throws if client code touches them, and they never enter the bundle.
 * - client: NEXT_PUBLIC_* only. Next.js inlines them at BUILD time, so each Vercel scope must build with its own values.
 * Per-variable formats are below; rules that depend on APP_ENV (dev | production) live in shared/config/env-rules.ts.
 * Set SKIP_ENV_VALIDATION=1 only for CI builds without secrets.
 */
const isServer = typeof window === "undefined";
// Resolved once, before validation: an APP_ENV / VERCEL_ENV conflict fails here with its own message.
const appEnv = isServer ? resolveAppEnv(process.env) : "dev";
const optionalUrl = z.url().optional().or(z.literal(""));

export const env = createEnv({
  server: {
    // dev | production. Defaults from VERCEL_ENV (production → production, preview/development → dev), else dev.
    APP_ENV: z.enum(APP_ENVS).optional(),
    DATABASE_URL: z.url(),
    // Direct (unpooled) connection for migrations; set by the Vercel + Neon integration. Optional locally.
    DATABASE_URL_UNPOOLED: optionalUrl,
    // Only "test", for automated tests and CI fixtures; app environments come from APP_ENV.
    DATABASE_TARGET: z.literal("test").optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    // Payments, email and storage: required in production, all-or-nothing in dev (see env-rules.ts).
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    STRIPE_PRICE_STATIC: z.string().startsWith("price_").optional(),
    STRIPE_PRICE_DYNAMIC_MONTHLY: z.string().startsWith("price_").optional(),
    // Optional add-on: without it the Print Pack can be previewed but not bought (the UI says so).
    STRIPE_PRICE_PRINT_PACK: z.string().startsWith("price_").optional(),
    DYNAMIC_ACTIVE_CODE_LIMIT: z.coerce.number().int().positive().default(10),
    RESEND_API_KEY: z.string().startsWith("re_").optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_ENDPOINT: optionalUrl,
    S3_PUBLIC_URL: z.url().optional(),
    UPSTASH_REDIS_REST_URL: optionalUrl,
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    NEXT_PUBLIC_SHORT_LINK_BASE: z.url(),
    NEXT_PUBLIC_PRICE_STATIC_CENTS: z.coerce.number().int().nonnegative().default(499),
    NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS: z.coerce.number().int().nonnegative().default(600),
    NEXT_PUBLIC_PRICE_PRINT_PACK_CENTS: z.coerce.number().int().nonnegative().default(299),
    NEXT_PUBLIC_PRICE_CURRENCY: z.string().length(3).default("USD"),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SHORT_LINK_BASE: process.env.NEXT_PUBLIC_SHORT_LINK_BASE,
    NEXT_PUBLIC_PRICE_STATIC_CENTS: process.env.NEXT_PUBLIC_PRICE_STATIC_CENTS,
    NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS: process.env.NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS,
    NEXT_PUBLIC_PRICE_PRINT_PACK_CENTS: process.env.NEXT_PUBLIC_PRICE_PRINT_PACK_CENTS,
    NEXT_PUBLIC_PRICE_CURRENCY: process.env.NEXT_PUBLIC_PRICE_CURRENCY,
  },
  // Environment-dependent rules run on the server, where every variable is visible.
  createFinalSchema: (shape, server) =>
    z.object(shape).superRefine((values, ctx) => {
      if (!server) return;
      for (const p of environmentProblems(appEnv, values)) ctx.addIssue({ code: "custom", path: [p.variable], message: p.message });
    }),
  onValidationError: (issues) => {
    const lines = issues.map((i) => {
      const key = i.path?.map((p) => (typeof p === "object" ? p.key : p)).join(".") ?? "(unknown)";
      return `  - ${String(key)}: ${i.message}`;
    });
    throw new Error(
      `Invalid environment variables for APP_ENV=${appEnv} (values are not shown):\n${lines.join("\n")}\nSee .env.example and docs/ENVIRONMENTS.md.`,
    );
  },
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});
