import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const subscription = vi.fn();
vi.mock("../db", () => ({
  db: {
    query: {
      subscription: { findFirst: () => subscription(), findMany: async () => (await subscription()) ?? [] },
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

/* HEY-142: a Dynamic code's files carry its short link: downloadable only while its owner has paid access. */
describe("Dynamic downloads at the paid period's end (HEY-142)", () => {
  const live = { userId: "u1", model: "dynamic" as const, purchasedAt: null, status: "active", shortCode: "AbCdEf2", isTrial: false };
  const cutoff = new Date(Date.now() + 60_000);
  const sub = (over: Record<string, unknown> = {}) => ({
    status: "active",
    cancelAtPeriodEnd: false,
    cancelAt: null,
    currentPeriodEnd: cutoff,
    ...over,
  });

  it("with paid access: yes; a cancellation scheduled for later still allows it", async () => {
    subscription.mockResolvedValue([sub()]);
    expect(await canDownload("u1", live)).toBe(true);
    subscription.mockResolvedValue([sub({ cancelAtPeriodEnd: true, cancelAt: cutoff })]);
    expect(await canDownload("u1", live)).toBe(true);
  });

  it("past the scheduled cutoff (even before the final webhook), or with no plan: refused; a paused code too", async () => {
    subscription.mockResolvedValue([sub({ cancelAtPeriodEnd: true, cancelAt: new Date(Date.now() - 1) })]);
    expect(await canDownload("u1", live)).toBe(false);
    subscription.mockResolvedValue([]);
    expect(await canDownload("u1", live)).toBe(false);
    subscription.mockResolvedValue([sub()]);
    expect(await canDownload("u1", { ...live, status: "paused" })).toBe(false);
  });
});
