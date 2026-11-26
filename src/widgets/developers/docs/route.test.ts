import { describe, expect, it, vi } from "vitest";

/* Release gates: in production the REST reference and the design previews don't exist (404); elsewhere they render. */
vi.mock("server-only", () => ({}));
const env = vi.hoisted(() => ({ appEnv: "production" as "production" | "dev" }));
vi.mock("@/server/config", () => ({
  get appEnv() {
    return env.appEnv;
  },
}));
const { docsPageFor } = await import("./route");

const gated = ["rest/authentication", "rest/create", "rest/bulk", "rest/destination", "rest/scans", "rest/errors", "rest/sdk"];

describe("docs release gates (design 12.18–12.22)", () => {
  it("production: public pages only; every REST reference and preview path is not found", () => {
    env.appEnv = "production";
    expect(docsPageFor([])?.page.id).toBe("overview");
    expect(docsPageFor(["rest"])?.page.id).toBe("rest");
    expect(docsPageFor(["install"])).toMatchObject({ previews: false });
    for (const path of gated) expect(docsPageFor(path.split("/")), path).toBeNull();
    expect(docsPageFor(["nope"])).toBeNull();
  });

  it("dev and preview builds: the gated pages render, marked as previews", () => {
    env.appEnv = "dev";
    for (const path of gated) expect(docsPageFor(path.split("/")), path).toMatchObject({ previews: true });
  });
});
