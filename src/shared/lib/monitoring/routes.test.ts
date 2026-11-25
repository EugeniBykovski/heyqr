import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { areaOf, isCheckoutReturn, routeTemplate, STATIC_SEGMENTS } from "./routes";

describe("monitoring route templates (HEY-175)", () => {
  it("every static segment of src/app is known, so no page loses its name", () => {
    const app = fileURLToPath(new URL("../../../app", import.meta.url));
    const dirs = readdirSync(app, { recursive: true, withFileTypes: true })
      .filter((d) => d.isDirectory() && !/^[[(]/.test(d.name))
      .map((d) => d.name);
    expect(dirs.filter((d) => !STATIC_SEGMENTS.has(d))).toEqual([]);
  });

  it("paths and route files of one page are one template; ids, codes and unknown words never stay", () => {
    for (const [path, template] of [
      ["/", "/"],
      ["/dashboard/api-keys", "/dashboard/api-keys"],
      ["/sign-in?next=/x", "/sign-in"],
      ["/de/dashboard/qr/lowercaseid?x=1", "/dashboard/qr/[id]"],
      ["/[locale]/(account)/dashboard/qr/[id]/page", "/dashboard/qr/[id]"],
      ["/r/AbCdEf2", "/r/[code]"],
      ["/r/[code]/route", "/r/[code]"],
      ["/p/AbCdEf2/a/1JWbMmFtZ3", "/p/[code]/a/[id]"],
      ["/api/export/[layoutId]", "/api/export/[id]"],
      ["/api/export/all/Q1", "/api/export/all/[id]"],
      ["/someone-typed-this", "/[id]"],
    ] as const)
      expect(routeTemplate(path), path).toBe(template);
  });

  it("areas: the checkout return is recognized by its marker only", () => {
    expect(isCheckoutReturn("?checkout=success&session_id=cs_1")).toBe(true);
    expect(areaOf("/create/export", true)).toBe("checkout_return");
    expect(areaOf("/dashboard/billing", true)).toBe("checkout_return");
    expect([areaOf("/create/export"), areaOf("/edit/[id]"), areaOf("/dashboard"), areaOf("/r/[code]"), areaOf("/pricing")]).toEqual([
      "export",
      "editor",
      "dashboard",
      "qr_access",
      "other",
    ]);
  });
});
