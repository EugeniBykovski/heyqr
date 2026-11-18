import { describe, expect, it } from "vitest";
import { environmentProblems } from "./env-rules";

const base = {
  DATABASE_URL: "postgres://u:p@db.example.com/heyqr",
  NEXT_PUBLIC_APP_URL: "https://heyqr.app",
  NEXT_PUBLIC_SHORT_LINK_BASE: "https://hqr.to",
  BETTER_AUTH_URL: "https://heyqr.app",
};
const stripeLive = {
  STRIPE_SECRET_KEY: "sk_live_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_PRICE_STATIC: "price_a",
  STRIPE_PRICE_DYNAMIC_MONTHLY: "price_b",
};
const email = { RESEND_API_KEY: "re_x", EMAIL_FROM: "Hey QR <hello@heyqr.app>" };
const storage = {
  S3_REGION: "eu-central-1",
  S3_BUCKET: "heyqr",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_PUBLIC_URL: "https://cdn.heyqr.app",
};
const vars = (problems: { variable: string }[]) => problems.map((p) => p.variable).sort();

describe("environmentProblems", () => {
  it("accepts a complete production configuration", () => {
    expect(environmentProblems("production", { ...base, ...stripeLive, ...email, ...storage })).toEqual([]);
  });

  it("requires every integration in production and names the missing variables", () => {
    const problems = environmentProblems("production", { ...base, ...stripeLive });
    expect(vars(problems)).toEqual([
      "EMAIL_FROM",
      "RESEND_API_KEY",
      "S3_ACCESS_KEY_ID",
      "S3_BUCKET",
      "S3_PUBLIC_URL",
      "S3_REGION",
      "S3_SECRET_ACCESS_KEY",
    ]);
    expect(problems.every((p) => /required in production/.test((p as { message: string }).message))).toBe(true);
  });

  it("lets dev run without integrations, but not half-configured", () => {
    const dev = {
      ...base,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SHORT_LINK_BASE: "http://localhost:3000/r",
      BETTER_AUTH_URL: "http://localhost:3000",
    };
    expect(environmentProblems("dev", dev)).toEqual([]);
    expect(vars(environmentProblems("dev", { ...dev, RESEND_API_KEY: "re_x" }))).toEqual(["EMAIL_FROM"]);
  });

  it("keeps Stripe in test mode on dev and live mode on production", () => {
    expect(vars(environmentProblems("dev", { ...base, ...stripeLive }))).toEqual(["STRIPE_SECRET_KEY"]);
    expect(environmentProblems("dev", { ...base, ...stripeLive, STRIPE_SECRET_KEY: "sk_test_x" })).toEqual([]);
    expect(
      vars(environmentProblems("production", { ...base, ...stripeLive, ...email, ...storage, STRIPE_SECRET_KEY: "sk_test_x" })),
    ).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("requires public https URLs and its own database in production", () => {
    const local = {
      ...base,
      ...stripeLive,
      ...email,
      ...storage,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      BETTER_AUTH_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://h/heyqr_test",
    };
    expect(vars(environmentProblems("production", local))).toEqual(["BETTER_AUTH_URL", "DATABASE_URL", "NEXT_PUBLIC_APP_URL"]);
  });

  it("keeps auth on the app origin so Google's callback URL matches", () => {
    expect(vars(environmentProblems("dev", { ...base, BETTER_AUTH_URL: "https://auth.example.com" }))).toEqual(["BETTER_AUTH_URL"]);
  });

  it("never echoes values in messages", () => {
    const problems = environmentProblems("dev", { ...base, ...stripeLive });
    expect(JSON.stringify(problems)).not.toContain("sk_live_x");
  });
});
