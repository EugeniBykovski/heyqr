import { describe, expect, it } from "vitest";
import { ownerStatus, scansLive } from "./access";
import type { TrialPhase } from "./trial";

/*
 * HEY-185: what the owner's screens call a code follows what its short link does (resolveShortLink), so a code whose
 * scans show "not active right now" is never shown as Active.
 */
const end = new Date("2026-12-24T12:00:00Z");
const phase = (state: TrialPhase["state"]) => ({ state, startedAt: null, endsAt: end }) as unknown as TrialPhase;
const code = (over: Partial<{ model: string; status: string; isTrial: boolean; takenDownAt: Date | null }> = {}) => ({
  model: "dynamic",
  status: "active",
  isTrial: false,
  takenDownAt: null,
  ...over,
});

describe("scansLive / ownerStatus (HEY-185)", () => {
  it("a live Dynamic code is Active only while its owner has paid access", () => {
    expect([scansLive(code(), { plan: true, trial: phase("none") }), ownerStatus(code(), { plan: true, trial: phase("none") })]).toEqual([
      true,
      "active",
    ]);
    // The plan ended (or was never taken): scanners get "not active right now", the owner sees Not active.
    expect([scansLive(code(), { plan: false, trial: phase("none") }), ownerStatus(code(), { plan: false, trial: phase("none") })]).toEqual([
      false,
      "inactive",
    ]);
  });

  it("the trial's test code is Active while the trial runs, Not active after it, Active again with a plan", () => {
    const test = code({ isTrial: true });
    expect(ownerStatus(test, { plan: false, trial: phase("active") })).toBe("active");
    expect(ownerStatus(test, { plan: false, trial: phase("ending") })).toBe("active");
    expect(ownerStatus(test, { plan: false, trial: phase("expired") })).toBe("inactive");
    expect(ownerStatus(test, { plan: true, trial: phase("upgraded") })).toBe("active");
    // Only the test code rides on the trial.
    expect(ownerStatus(code(), { plan: false, trial: phase("active") })).toBe("inactive");
  });

  it("a plan never overrides the owner's pause or an operator's takedown; static codes don't depend on it", () => {
    const access = { plan: true, trial: phase("none") };
    expect(ownerStatus(code({ status: "paused" }), access)).toBe("paused");
    expect(scansLive(code({ takenDownAt: new Date() }), access)).toBe(false);
    expect(ownerStatus(code({ model: "static" }), { plan: false, trial: phase("none") })).toBe("purchased");
    expect(ownerStatus(code({ status: "draft" }), access)).toBe("draft");
  });
});
