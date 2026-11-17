import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Typed, validated environment. Server values never reach the client bundle;
 * only NEXT_PUBLIC_* values are exposed. Set SKIP_ENV_VALIDATION=1 for CI builds without secrets.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
    STRIPE_PRICE_STATIC: z.string().startsWith("price_"),
    STRIPE_PRICE_DYNAMIC_MONTHLY: z.string().startsWith("price_"),
    DYNAMIC_ACTIVE_CODE_LIMIT: z.coerce.number().int().positive().default(10),
    RESEND_API_KEY: z.string().startsWith("re_"),
    EMAIL_FROM: z.string().min(3),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_ENDPOINT: z.url().optional().or(z.literal("")),
    S3_PUBLIC_URL: z.url(),
    UPSTASH_REDIS_REST_URL: z.url().optional().or(z.literal("")),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    NEXT_PUBLIC_SHORT_LINK_BASE: z.url(),
    NEXT_PUBLIC_PRICE_STATIC_CENTS: z.coerce.number().int().nonnegative().default(499),
    NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS: z.coerce.number().int().nonnegative().default(600),
    NEXT_PUBLIC_PRICE_CURRENCY: z.string().length(3).default("USD"),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SHORT_LINK_BASE: process.env.NEXT_PUBLIC_SHORT_LINK_BASE,
    NEXT_PUBLIC_PRICE_STATIC_CENTS: process.env.NEXT_PUBLIC_PRICE_STATIC_CENTS,
    NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS: process.env.NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS,
    NEXT_PUBLIC_PRICE_CURRENCY: process.env.NEXT_PUBLIC_PRICE_CURRENCY,
  },
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});
