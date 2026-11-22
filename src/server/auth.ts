import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { cache } from "react";
import { env } from "@/env";
import { db, schema } from "./db";

/** Google is the only sign-in method. Sessions are stored in Postgres. */
export const auth = betterAuth({
  appName: "Hey QR",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  },
  user: {
    additionalFields: {
      locale: { type: "string", required: false, input: false },
      stripeCustomerId: { type: "string", required: false, input: false },
    },
  },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  // HEY-73: an OAuth error without a per-flow errorCallbackURL (e.g. cancelling again after Back to Google, whose
  // state was already used) lands on the sign-in page with a retry instead of Better Auth's generic error page.
  // State validation itself is unchanged.
  onAPIError: { errorURL: `${env.BETTER_AUTH_URL}/sign-in` },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

/** Current session for Server Components, actions and route handlers (deduped per request). */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser() {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session.user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Sign in required");
    this.name = "UnauthorizedError";
  }
}
