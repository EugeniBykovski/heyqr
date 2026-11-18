import { describe, expect, it } from "vitest";
import { assertAllowed, DatabaseConfigError, describeDatabaseUrl, migrationUrl, resolveDbTarget } from "./target";

describe("resolveDbTarget", () => {
  it("follows the app environment: dev locally and on Vercel Preview, production on Vercel Production", () => {
    expect(resolveDbTarget({})).toBe("dev");
    expect(resolveDbTarget({ APP_ENV: "dev" })).toBe("dev");
    expect(resolveDbTarget({ VERCEL_ENV: "preview" })).toBe("dev");
    expect(resolveDbTarget({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveDbTarget({ APP_ENV: "production" })).toBe("production");
  });
  it("is test under the test runner or with DATABASE_TARGET=test, never on a deployment", () => {
    expect(resolveDbTarget({ NODE_ENV: "test" })).toBe("test");
    expect(resolveDbTarget({ DATABASE_TARGET: "test" })).toBe("test");
    expect(resolveDbTarget({ DATABASE_TARGET: "" })).toBe("dev");
    expect(() => resolveDbTarget({ DATABASE_TARGET: "test", VERCEL_ENV: "preview" })).toThrow(DatabaseConfigError);
  });
  it("points HEY-7's old DATABASE_TARGET values at APP_ENV", () => {
    expect(() => resolveDbTarget({ DATABASE_TARGET: "preview" })).toThrow(/APP_ENV=dev/);
    expect(() => resolveDbTarget({ DATABASE_TARGET: "local" })).toThrow(/APP_ENV=dev/);
    expect(() => resolveDbTarget({ DATABASE_TARGET: "production" })).toThrow(/APP_ENV=production/);
  });
  it("rejects an APP_ENV that conflicts with Vercel", () => {
    expect(() => resolveDbTarget({ APP_ENV: "production", VERCEL_ENV: "preview" })).toThrow(/preview scope serves dev/);
  });
});

describe("connection URLs", () => {
  it("masks credentials", () => {
    expect(describeDatabaseUrl("postgres://user:s3cret@db.example.com:5432/heyqr_dev?sslmode=require")).toBe(
      "db.example.com:5432/heyqr_dev",
    );
  });
  it("migrates over the direct connection when there is one", () => {
    expect(migrationUrl({ DATABASE_URL: "postgres://pooled/db", DATABASE_URL_UNPOOLED: "postgres://direct/db" })).toBe(
      "postgres://direct/db",
    );
    expect(migrationUrl({ DATABASE_URL: "postgres://pooled/db" })).toBe("postgres://pooled/db");
    expect(() => migrationUrl({})).toThrow(/DATABASE_URL is not set/);
  });
});

describe("assertAllowed", () => {
  const prod = "postgres://u:p@prod.example.com/heyqr";
  it("never seeds production and migrates it only with explicit confirmation", () => {
    expect(() => assertAllowed("seed", "production", prod, {})).toThrow(/Refusing to seed/);
    expect(() => assertAllowed("migrate", "production", prod, {})).toThrow(/CONFIRM_PRODUCTION_MIGRATION/);
    expect(() => assertAllowed("migrate", "production", prod, { CONFIRM_PRODUCTION_MIGRATION: "1" })).not.toThrow();
  });
  it("seeds dev and test", () => {
    for (const target of ["dev", "test"] as const) expect(() => assertAllowed("seed", target, "postgres://h/db", {})).not.toThrow();
  });
  it("resets only *_test databases with the test target", () => {
    expect(() => assertAllowed("reset", "test", "postgres://h/heyqr_test", {})).not.toThrow();
    expect(() => assertAllowed("reset", "test", "postgres://h/heyqr", {})).toThrow(/_test/);
    expect(() => assertAllowed("reset", "dev", "postgres://h/heyqr_test", {})).toThrow(/_test/);
  });
  it("does not leak credentials in errors", () => {
    expect(() => assertAllowed("seed", "production", prod, {})).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("u:p") }),
    );
  });
});
