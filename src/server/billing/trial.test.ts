import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, trialCovers, trialPhase } from "./trial";

const DAY = 86_400_000;
const start = new Date("2026-11-01T10:00:00Z");
const user = { trialStartedAt: start, trialEndsAt: new Date(start.getTime() + TRIAL_DAYS * DAY) };
const at = (days: number) => new Date(start.getTime() + days * DAY);

describe("Starter trial phases (design 9.1–9.4)", () => {
  it("never started: eligible unless a Dynamic plan is already active", () => {
    expect(trialPhase({ trialStartedAt: null, trialEndsAt: null }, false)).toEqual({ state: "none", eligible: true });
    expect(trialPhase({ trialStartedAt: null, trialEndsAt: null }, true)).toEqual({ state: "none", eligible: false });
  });

  it("active with the day and days left; ending in its last day; expired at the end", () => {
    expect(trialPhase(user, false, at(0.1))).toMatchObject({ state: "active", day: 1, daysLeft: 7 });
    expect(trialPhase(user, false, at(5.5))).toMatchObject({ state: "active", day: 6, daysLeft: 2 });
    expect(trialPhase(user, false, at(6.5))).toMatchObject({ state: "ending", day: 7, daysLeft: 1 });
    expect(trialPhase(user, false, at(7))).toMatchObject({ state: "expired" });
    expect(trialPhase(user, false, at(30))).toMatchObject({ state: "expired" });
  });

  it("a Dynamic plan after a trial is upgraded, whenever it was taken", () => {
    expect(trialPhase(user, true, at(3)).state).toBe("upgraded");
    expect(trialPhase(user, true, at(30)).state).toBe("upgraded");
  });

  it("only the test code is covered, and only while the trial runs", () => {
    expect(trialCovers(trialPhase(user, false, at(2)), { isTrial: true })).toBe(true);
    expect(trialCovers(trialPhase(user, false, at(6.9)), { isTrial: true })).toBe(true);
    expect(trialCovers(trialPhase(user, false, at(2)), { isTrial: false })).toBe(false);
    expect(trialCovers(trialPhase(user, false, at(8)), { isTrial: true })).toBe(false);
  });
});
