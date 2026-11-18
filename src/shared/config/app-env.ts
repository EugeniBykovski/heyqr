/**
 * The HeyQR application environment: `dev` or `production`.
 * Plain module (no "server-only", no env import): used by src/env.ts, the database scripts and the workflows' commands.
 *
 *   APP_ENV           explicit selector; `dev` or `production`
 *   VERCEL_ENV        set by Vercel: production → production, preview / development → dev
 *   neither           dev (local development)
 *
 * NODE_ENV is separate and follows Next.js: a deployed dev site runs a production build (NODE_ENV=production)
 * while APP_ENV stays dev.
 */
export const APP_ENVS = ["dev", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Vercel's deployment scopes and the HeyQR environment each one serves. */
export const VERCEL_SCOPE_TO_APP_ENV = { production: "production", preview: "dev", development: "dev" } as const satisfies Record<
  string,
  AppEnv
>;

/** A configuration problem whose message names the variables and the environment, never their values. */
export class EnvConfigError extends Error {
  override name = "EnvConfigError";
}

type Env = Record<string, string | undefined>;

export function resolveAppEnv(env: Env = process.env): AppEnv {
  const explicit = env.APP_ENV || undefined;
  if (explicit !== undefined && !APP_ENVS.includes(explicit as AppEnv)) {
    throw new EnvConfigError(`APP_ENV must be "dev" or "production" (got "${explicit}").`);
  }
  const scope = env.VERCEL_ENV as keyof typeof VERCEL_SCOPE_TO_APP_ENV | undefined;
  const fromVercel = scope ? VERCEL_SCOPE_TO_APP_ENV[scope] : undefined;
  if (explicit && fromVercel && explicit !== fromVercel) {
    throw new EnvConfigError(
      `APP_ENV is "${explicit}" but Vercel's ${scope} scope serves ${fromVercel}. Set APP_ENV=${fromVercel} for the ${scope} scope in Vercel, or remove it.`,
    );
  }
  return (explicit as AppEnv | undefined) ?? fromVercel ?? "dev";
}
