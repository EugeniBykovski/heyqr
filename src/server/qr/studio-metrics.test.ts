import { describe, expect, it } from "vitest";
import { studioMetrics, type StudioMetricsInput } from "./studio-metrics";

/* HEY-198: the signed-in home's figures, from the account's own codes, scans and plan. */
const days = (counts: number[]) => counts.map((count, i) => ({ day: `2026-11-${String(14 + i).padStart(2, "0")}`, count }));
const code = (id: string, model: "static" | "dynamic", paid: boolean, name = id) => ({
  id,
  name,
  model,
  purchasedAt: model === "static" && paid ? new Date("2026-11-01") : null,
  shortCode: model === "dynamic" && paid ? `s${id}` : null,
});
const base: StudioMetricsInput = {
  codes: [
    code("a", "static", true),
    code("b", "static", false),
    code("c", "dynamic", true, "Menu"),
    code("d", "dynamic", true, "Poster"),
    code("e", "dynamic", false),
  ],
  scans: days([1, 2, 0, 3, 1, 2, 1, 4, 5, 2, 3, 6, 2, 3]),
  scansByCode: new Map([
    ["c", { total: 25 }],
    ["d", { total: 10 }],
  ]),
  firstScanDay: "2026-10-02",
  filesReady: 4,
  dynamic: { used: 2, limit: 5 },
};

describe("Your studio figures (HEY-198)", () => {
  it("counts codes, paid and drafts: bought static and activated Dynamic codes are paid", () => {
    expect(studioMetrics(base)).toMatchObject({ total: 5, paid: 3, drafts: 2 });
  });

  it("sums the 14 days and compares the last 7 with the 7 before when both are in the scan history", () => {
    const m = studioMetrics(base);
    expect(m.scans).toBe(35);
    // Earlier week 1+2+0+3+1+2+1 = 10, later 4+5+2+3+6+2+3 = 25.
    expect(m.weekOverWeek).toBeCloseTo(1.5);
  });

  it("leaves week-over-week out when the history starts inside the window or the earlier week had no scans", () => {
    expect(studioMetrics({ ...base, firstScanDay: "2026-11-20" }).weekOverWeek).toBeNull();
    expect(studioMetrics({ ...base, firstScanDay: null }).weekOverWeek).toBeNull();
    expect(studioMetrics({ ...base, scans: days([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]) }).weekOverWeek).toBeNull();
    // The history starting exactly on the window's first day counts as complete.
    expect(studioMetrics({ ...base, firstScanDay: "2026-11-14" }).weekOverWeek).toBeCloseTo(1.5);
  });

  it("shows Dynamic codes against the plan limit and what is left, never below zero", () => {
    expect(studioMetrics(base).dynamic).toEqual({ used: 2, limit: 5, remaining: 3 });
    expect(studioMetrics({ ...base, dynamic: { used: 7, limit: 5 } }).dynamic.remaining).toBe(0);
    expect(studioMetrics({ ...base, dynamic: { used: 0, limit: 0 } }).dynamic).toEqual({ used: 0, limit: 0, remaining: 0 });
  });

  it("names the Dynamic code with the most scans, and none when nothing was scanned", () => {
    expect(studioMetrics(base).top).toEqual({ id: "c", name: "Menu", scans: 25 });
    expect(studioMetrics({ ...base, scansByCode: new Map() }).top).toBeNull();
  });

  it("a new account is all zeros with no comparison and no top code", () => {
    const m = studioMetrics({
      codes: [],
      scans: days(Array(14).fill(0)),
      scansByCode: new Map(),
      firstScanDay: null,
      filesReady: 0,
      dynamic: { used: 0, limit: 0 },
    });
    expect(m).toEqual({
      total: 0,
      paid: 0,
      drafts: 0,
      scans: 0,
      weekOverWeek: null,
      dynamic: { used: 0, limit: 0, remaining: 0 },
      filesReady: 0,
      top: null,
    });
  });
});
