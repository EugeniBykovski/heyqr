// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import type { Usage } from "@/server/billing/allowances";
import { UsageTiles } from "./usage-tiles";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages: en, namespace: namespace as "billing" }),
  getFormatter: async () => createFormatter({ locale: "en", timeZone: "UTC" }),
}));
afterEach(cleanup);

const periodStart = new Date("2026-11-01T00:00:00Z");
const periodEnd = new Date("2026-12-01T00:00:00Z");
const usage = (over: Partial<Usage> & { plan?: Usage["plan"] }): Usage => ({
  plan: null,
  credits: 0,
  unlocks: { used: 0, limit: 0 },
  packs: { used: 0, limit: 0 },
  dynamic: { used: 0, limit: 0 },
  ...over,
});
const starter = (cancelAtPeriodEnd = false) => ({
  overdue: false,
  id: "starter" as const,
  periodStart,
  periodEnd,
  cancelAtPeriodEnd,
  endsAt: cancelAtPeriodEnd ? periodEnd : null,
});
const studio = { id: "studio" as const, periodStart, periodEnd, cancelAtPeriodEnd: false, endsAt: null, overdue: false };
const show = async (u: Usage, credits: "always" | "never" | "auto" = "auto") =>
  render(<>{await UsageTiles({ usage: u, printPackCents: 299, currency: "USD", credits })}</>);
const tile = (slot: string) => document.querySelector(`[data-slot="usage-${slot}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? null;

/* HEY-136: what is used and what is left, from accountUsage(); monthly allowances say when (and whether) they reset. */
describe("UsageTiles (HEY-136)", () => {
  it("Starter with 4 live codes: 4 of 5, 1 available; after the fifth, 0 available; no Print Pack tile", async () => {
    await show(usage({ plan: starter(), dynamic: { used: 4, limit: 5 }, unlocks: { used: 3, limit: 10 } }));
    expect(tile("dynamic")).toContain("4 of 5 · 1 available");
    expect(tile("dynamic")).not.toMatch(/Resets/);
    expect(tile("unlocks")).toContain("3 of 10 · 7 left this month");
    expect(tile("unlocks")).toContain("Resets Dec 1, 2026");
    expect(tile("packs")).toBeNull();
    cleanup();
    await show(usage({ plan: starter(), dynamic: { used: 5, limit: 5 }, unlocks: { used: 10, limit: 10 } }));
    expect(tile("dynamic")).toContain("5 of 5 · 0 available");
    expect(tile("unlocks")).toContain("10 of 10 · 0 left this month");
  });

  it("Studio: 25 slots and included Print Packs, 0 left when exhausted, with the reset date", async () => {
    await show(usage({ plan: studio, dynamic: { used: 25, limit: 25 }, unlocks: { used: 1, limit: 40 }, packs: { used: 5, limit: 5 } }));
    expect(tile("dynamic")).toContain("25 of 25 · 0 available");
    expect(tile("packs")).toContain("5 of 5 · 0 left this month");
    expect(tile("packs")).toContain("Resets Dec 1, 2026 · then +$2.99");
  });

  it("a scheduled cancellation shows when the plan ends instead of a reset", async () => {
    await show(usage({ plan: starter(true), dynamic: { used: 1, limit: 5 }, unlocks: { used: 0, limit: 10 } }));
    expect(tile("unlocks")).toContain("Plan ends Dec 1, 2026 · no reset");
    expect(tile("unlocks")).not.toContain("Resets");
  });

  it("credits: the balance, one-time and without a monthly reset; shown with no plan, or always when asked", async () => {
    await show(usage({ credits: 2 }));
    expect([tile("credits"), tile("dynamic")]).toEqual(["Static creditsOne-time2 leftNever expire · used after monthly unlocks", null]);
    cleanup();
    await show(usage({ plan: starter(), dynamic: { used: 0, limit: 5 }, unlocks: { used: 0, limit: 10 } }));
    expect(tile("credits")).toBeNull();
    cleanup();
    await show(usage({ plan: starter(), dynamic: { used: 0, limit: 5 }, unlocks: { used: 0, limit: 10 } }), "always");
    expect(tile("credits")).toContain("0 left");
  });

  it("HEY-139: a cancellation set for another date (Stripe's cancel_at) shows that date", async () => {
    const endsAt = new Date("2026-12-10T00:00:00Z");
    await show(usage({ plan: { ...starter(true), endsAt }, dynamic: { used: 1, limit: 5 }, unlocks: { used: 0, limit: 10 } }));
    expect(tile("unlocks")).toContain("Plan ends Dec 10, 2026 · no reset");
  });
});
