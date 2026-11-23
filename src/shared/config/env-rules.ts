import type { AppEnv } from "./app-env";

/**
 * Rules that depend on the application environment or on several variables at once.
 * src/env.ts applies them after the per-variable formats; they are a plain function so they can be tested alone.
 * Messages name variables and the environment, never values.
 */
export type EnvProblem = { variable: string; message: string };

/** Integrations whose credentials are optional in dev (the feature then reports itself as not configured). */
export const INTEGRATIONS = {
  payments: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STATIC", "STRIPE_PRICE_DYNAMIC_MONTHLY"],
  email: ["RESEND_API_KEY", "EMAIL_FROM"],
  // HEY-83: a private bucket; nothing is served from a public URL, so S3_PUBLIC_URL is not part of storage.
  storage: ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
} as const;
export type Integration = keyof typeof INTEGRATIONS;

type Values = Record<string, unknown>;
const present = (v: unknown) => v !== undefined && v !== null && v !== "";
const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url);

function origin(url: unknown) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return undefined;
  }
}

export function environmentProblems(appEnv: AppEnv, v: Values): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const add = (variable: string, message: string) => problems.push({ variable, message });

  // Integrations: all variables in production; all or none in dev, so a half-configured integration is caught early.
  for (const [name, vars] of Object.entries(INTEGRATIONS)) {
    const missing = vars.filter((k) => !present(v[k]));
    if (appEnv === "production") missing.forEach((k) => add(k, `required in production (${name})`));
    else if (missing.length && missing.length < vars.length)
      missing.forEach((k) => add(k, `required in dev because other ${name} variables are set`));
  }

  // Stripe mode follows the environment: test keys never charge real cards, live keys never run outside production.
  const stripeKey = v.STRIPE_SECRET_KEY;
  if (present(stripeKey)) {
    const wanted = appEnv === "production" ? "sk_live_" : "sk_test_";
    if (!String(stripeKey).startsWith(wanted))
      add("STRIPE_SECRET_KEY", `must be a ${appEnv === "production" ? "live" : "test"}-mode key (${wanted}…) in ${appEnv}`);
  }

  // Google's OAuth callback is {BETTER_AUTH_URL}/api/auth/callback/google, so auth must live on the app's own origin.
  if (present(v.BETTER_AUTH_URL) && present(v.NEXT_PUBLIC_APP_URL) && origin(v.BETTER_AUTH_URL) !== origin(v.NEXT_PUBLIC_APP_URL)) {
    add("BETTER_AUTH_URL", "must have the same origin as NEXT_PUBLIC_APP_URL");
  }

  if (appEnv === "production") {
    // HEY-109: buyers are told where to get help before they pay; a release without a confirmed contact isn't ready.
    if (!present(v.SUPPORT_EMAIL)) add("SUPPORT_EMAIL", "required in production (the support contact shown before payment)");
    for (const k of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SHORT_LINK_BASE", "BETTER_AUTH_URL"]) {
      const url = v[k];
      if (present(url) && (!String(url).startsWith("https://") || isLocalUrl(String(url))))
        add(k, "must be a public https:// URL in production");
    }
    const db = String(v.DATABASE_URL ?? "");
    if (/\/[^/?]*_test(\?|$)/.test(db)) add("DATABASE_URL", "points at a *_test database; production needs its own database");
  }
  return problems;
}
