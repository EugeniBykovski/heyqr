import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const subscription = vi.fn();
vi.mock("../db", () => ({
  db: {
    query: {
      subscription: { findFirst: () => subscription() },
      user: { findFirst: async () => ({ trialStartedAt: null, trialEndsAt: null }) },
    },
  },
  schema: { subscription: { userId: "user_id", status: "status" }, user: { id: "id" } },
}));
vi.mock("../config", () => ({ isConfigured: () => true }));
vi.mock("./catalog", () => ({ purchasable: () => true }));
const { canDownload, canDownloadPrintPack } = await import("./entitlements");

/* HEY-87: the one download decision. A static unlock belongs to the code (every layout, every format, forever). */
const code = (over: Partial<{ userId: string; purchasedAt: Date | null; printPackAt: Date | null }> = {}) => ({
  userId: "u1",
  model: "static" as const,
  purchasedAt: new Date("2026-11-01"),
  printPackAt: null as Date | null,
  ...over,
});

beforeEach(() => subscription.mockReset().mockResolvedValue(undefined));

describe("download entitlement (HEY-87)", () => {
  it("an unlocked static code downloads for its owner, with no plan (it outlives the subscription)", async () => {
    expect(await canDownload("u1", code())).toBe(true);
    expect(subscription).not.toHaveBeenCalled();
  });

  it("not for another account, a draft, or a different code with the same content", async () => {
    expect(await canDownload("u2", code())).toBe(false);
    expect(await canDownload("u1", code({ purchasedAt: null }))).toBe(false);
  });

  it("the Print Pack is its own grant on top of the unlock", async () => {
    expect(await canDownloadPrintPack("u1", code())).toBe(false);
    expect(await canDownloadPrintPack("u1", code({ printPackAt: new Date() }))).toBe(true);
    expect(await canDownloadPrintPack("u1", code({ purchasedAt: null, printPackAt: new Date() }))).toBe(false);
    expect(await canDownloadPrintPack("u2", code({ printPackAt: new Date() }))).toBe(false);
  });
});
