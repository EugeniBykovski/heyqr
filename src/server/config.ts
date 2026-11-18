import "server-only";
import { env } from "@/env";
import { resolveAppEnv, type AppEnv } from "@/shared/config/app-env";
import { INTEGRATIONS, type Integration } from "@/shared/config/env-rules";

/** The HeyQR environment this server runs as (dev | production); see shared/config/app-env.ts. */
export const appEnv: AppEnv = resolveAppEnv();

const LABELS: Record<Integration, string> = { payments: "Payments (Stripe)", email: "Email (Resend)", storage: "Storage (S3)" };

/** Thrown where an optional dev integration is used without its credentials. Names the variables, never values. */
export class IntegrationNotConfiguredError extends Error {
  override name = "IntegrationNotConfiguredError";
  constructor(
    readonly integration: Integration,
    missing: readonly string[],
  ) {
    super(`${LABELS[integration]} is not configured for APP_ENV=${appEnv}: set ${missing.join(", ")} (see docs/ENVIRONMENTS.md).`);
  }
}

function require<K extends string>(integration: Integration, keys: readonly K[]): Record<K, string> {
  const values = env as unknown as Record<string, string | undefined>;
  const missing = keys.filter((k) => !values[k]);
  if (missing.length) throw new IntegrationNotConfiguredError(integration, missing);
  return Object.fromEntries(keys.map((k) => [k, values[k] as string])) as Record<K, string>;
}

export const isConfigured = (integration: Integration) =>
  INTEGRATIONS[integration].every((k) => Boolean((env as unknown as Record<string, unknown>)[k]));

export const paymentsConfig = () => require("payments", INTEGRATIONS.payments);
export const emailConfig = () => require("email", INTEGRATIONS.email);
export const storageConfig = () => ({ ...require("storage", INTEGRATIONS.storage), S3_ENDPOINT: env.S3_ENDPOINT || undefined });
