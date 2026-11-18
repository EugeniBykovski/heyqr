import { describe, expect, it } from "vitest";
import { EnvConfigError, resolveAppEnv } from "./app-env";

describe("resolveAppEnv", () => {
  it("is dev for local development", () => {
    expect(resolveAppEnv({})).toBe("dev");
    expect(resolveAppEnv({ NODE_ENV: "production" })).toBe("dev");
  });
  it("maps Vercel scopes: Production → production, Preview and Development → dev", () => {
    expect(resolveAppEnv({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveAppEnv({ VERCEL_ENV: "preview" })).toBe("dev");
    expect(resolveAppEnv({ VERCEL_ENV: "development" })).toBe("dev");
  });
  it("accepts a matching APP_ENV and rejects a conflicting or unknown one", () => {
    expect(resolveAppEnv({ APP_ENV: "production" })).toBe("production");
    expect(resolveAppEnv({ APP_ENV: "dev", VERCEL_ENV: "preview" })).toBe("dev");
    expect(() => resolveAppEnv({ APP_ENV: "production", VERCEL_ENV: "preview" })).toThrow(/Vercel's preview scope serves dev/);
    expect(() => resolveAppEnv({ APP_ENV: "dev", VERCEL_ENV: "production" })).toThrow(EnvConfigError);
    expect(() => resolveAppEnv({ APP_ENV: "staging" })).toThrow(/"dev" or "production"/);
  });
});
