import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, readLimits } from "./rate-limit";

describe("public API rate limit settings (HEY-178)", () => {
  it("defaults, overrides, and the default for anything unusable (never unlimited)", () => {
    expect(readLimits({})).toEqual(DEFAULT_LIMITS);
    expect(readLimits({ API_RATE_LIMIT_PER_MINUTE: "10", API_RATE_LIMIT_EXPORTS_PER_MINUTE: "3" })).toEqual({ api: 10, export: 3 });
    for (const bad of ["", "0", "-1", "1.5", "many", "Infinity"])
      expect(readLimits({ API_RATE_LIMIT_PER_MINUTE: bad }), bad).toEqual(DEFAULT_LIMITS);
  });

  it("every /api/v1 handler starts with authorizeRequest, and only /api/v1 uses it", () => {
    const app = fileURLToPath(new URL("../../../app", import.meta.url));
    const routes = readdirSync(app, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith("route.ts"));
    const v1 = routes.filter((f) => f.startsWith("api/v1/"));
    expect(v1.length).toBeGreaterThan(0);
    for (const f of routes) {
      const source = readFileSync(`${app}/${f}`, "utf8");
      const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const guarded = source.match(/export async function \w+\([^)]*\) \{\n {2}try \{\n {4}const auth = await authorizeRequest\(/g) ?? [];
      expect([f, guarded.length]).toEqual([f, v1.includes(f) ? handlers.length : 0]);
    }
  });
});
