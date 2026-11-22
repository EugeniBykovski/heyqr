import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* HEY-75: a guest on any account page signs in with Google and comes back to that same page. */
let session: unknown = null;
const redirect = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ getSession: async () => session }));
vi.mock("@/i18n/navigation", () => ({ redirect: (...a: unknown[]) => redirect(...a) }));
const { requireAccount } = await import("./require-account");

beforeEach(() => {
  session = null;
  redirect.mockReset();
});

describe("account sign-in gate (HEY-75)", () => {
  it.each([
    ["/dashboard", {}, "/dashboard"],
    ["/dashboard", { filter: "dynamic", junk: ["a", "b"] }, "/dashboard?filter=dynamic"],
    ["/dashboard/billing", {}, "/dashboard/billing"],
    ["/dashboard/trial", {}, "/dashboard/trial"],
    ["/dashboard/qr/abc", {}, "/dashboard/qr/abc"],
  ])("a guest on %s returns there after sign-in", async (path, query, here) => {
    await requireAccount("en", path, query);
    expect(redirect).toHaveBeenCalledWith({ href: `/sign-in?next=${encodeURIComponent(here)}`, locale: "en" });
  });

  it("keeps the visitor's language", async () => {
    await requireAccount("ru", "/dashboard/billing");
    expect(redirect).toHaveBeenCalledWith({ href: `/sign-in?next=${encodeURIComponent("/dashboard/billing")}`, locale: "ru" });
  });

  it("a signed-in user passes through", async () => {
    session = { user: { id: "u1" } };
    expect(await requireAccount("en", "/dashboard")).toEqual({ id: "u1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("every account page is gated with its own return path", () => {
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "page.tsx") pages.push(p);
      }
    };
    walk(__dirname);
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const page of pages) expect(readFileSync(page, "utf8"), page).toMatch(/await requireAccount\(locale, [`"]\/dashboard/);
  });
});
