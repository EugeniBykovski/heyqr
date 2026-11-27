import { describe, expect, it, vi } from "vitest";

/*
 * Release gates (HEY-187): the REST API v1 is live in production, so its reference pages and the SDK page are public
 * everywhere. Only the design previews of unimplemented features (bulk create, scan statistics) 404 in production.
 */
vi.mock("server-only", () => ({}));
const env = vi.hoisted(() => ({ appEnv: "production" as "production" | "dev" }));
vi.mock("@/server/config", () => ({
  get appEnv() {
    return env.appEnv;
  },
}));
const { docsPageFor } = await import("./route");

const live = ["rest", "rest/authentication", "rest/create", "rest/destination", "rest/errors", "rest/sdk"];
const gated = ["rest/bulk", "rest/scans"];

describe("docs release gates (design 12.18–12.22)", () => {
  it("production: the SDK page and the live REST reference render; design previews are not found", () => {
    env.appEnv = "production";
    expect(docsPageFor([])?.page.id).toBe("overview");
    expect(docsPageFor(["install"])).toMatchObject({ previews: false });
    for (const path of live) expect(docsPageFor(path.split("/")), path).toMatchObject({ previews: false });
    expect(docsPageFor(["rest", "sdk"])?.page.id).toBe("restSdk");
    for (const path of gated) expect(docsPageFor(path.split("/")), path).toBeNull();
    expect(docsPageFor(["nope"])).toBeNull();
  });

  it("dev and preview builds: the design previews render too", () => {
    env.appEnv = "dev";
    for (const path of gated) expect(docsPageFor(path.split("/")), path).toMatchObject({ previews: true });
  });
});
