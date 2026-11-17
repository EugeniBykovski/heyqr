import { describe, expect, it } from "vitest";
import { assertAllowed, DatabaseConfigError, describeDatabaseUrl, migrationUrl, resolveDbTarget } from "./target";

describe("resolveDbTarget", () => {
  it("defaults to local, or test under the test runner", () => {
    expect(resolveDbTarget({})).toBe("local");
    expect(resolveDbTarget({ NODE_ENV: "test" })).toBe("test");
    expect(resolveDbTarget({ DATABASE_TARGET: "" })).toBe("local");
  });
  it("follows Vercel's environment and rejects a mismatching DATABASE_TARGET", () => {
    expect(resolveDbTarget({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(resolveDbTarget({ VERCEL_ENV: "preview", DATABASE_TARGET: "preview" })).toBe("preview");
    expect(() => resolveDbTarget({ VERCEL_ENV: "preview", DATABASE_TARGET: "production" })).toThrow(DatabaseConfigError);
    expect(() => resolveDbTarget({ DATABASE_TARGET: "staging" })).toThrow(/must be one of/);
  });
});

describe("connection URLs", () => {
  it("masks credentials", () => {
    expect(describeDatabaseUrl("postgres://user:s3cret@db.example.com:5432/heyqr_preview?sslmode=require")).toBe(
      "db.example.com:5432/heyqr_preview",
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
  it("seeds local, test and preview", () => {
    for (const target of ["local", "test", "preview"] as const)
      expect(() => assertAllowed("seed", target, "postgres://h/db", {})).not.toThrow();
  });
  it("resets only *_test databases with the test target", () => {
    expect(() => assertAllowed("reset", "test", "postgres://h/heyqr_test", {})).not.toThrow();
    expect(() => assertAllowed("reset", "test", "postgres://h/heyqr", {})).toThrow(/_test/);
    expect(() => assertAllowed("reset", "local", "postgres://h/heyqr_test", {})).toThrow(/_test/);
  });
  it("does not leak credentials in errors", () => {
    expect(() => assertAllowed("seed", "production", prod, {})).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("u:p") }),
    );
  });
});
