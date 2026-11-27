import { describe, expect, it } from "vitest";
import { contentErrors, eventDraftOk, eventTimeProblem } from "./content-validation";

/* HEY-193: an event's date and times (design 1.14), shared by the editor, the save path and the public API. */
describe("event date and times (HEY-193)", () => {
  it("needs a name and a real date; times are optional", () => {
    expect(contentErrors({ type: "event", title: "", start: "" })).toEqual({ title: "eventTitle", start: "eventStart" });
    expect(contentErrors({ type: "event", title: "Show", start: "2026-02-30" })).toEqual({ start: "eventDateInvalid" });
    expect(contentErrors({ type: "event", title: "Show", start: "2026-12-05" })).toEqual({});
    expect(contentErrors({ type: "event", title: "Show", start: "2026-12-05T19:00" })).toEqual({});
  });

  it("an end time comes after the start time, and needs one", () => {
    expect(eventTimeProblem("2026-12-05T19:00", "2026-12-05T21:30")).toBeNull();
    expect(eventTimeProblem("2026-12-05T19:00", "2026-12-05T19:00")).toBe("eventEnd");
    expect(eventTimeProblem("2026-12-05T19:00", "2026-12-05T18:00")).toBe("eventEnd");
    expect(eventTimeProblem("2026-12-05", "2026-12-05T18:00")).toBe("eventEndNeedsStart");
    expect(eventTimeProblem("2026-12-05T19:00", "2026-12-05T25:00")).toBe("eventEndInvalid");
    // The editor shows it under the end-time field.
    expect(contentErrors({ type: "event", title: "Show", start: "2026-12-05T19:00", end: "2026-12-05T18:00" })).toEqual({
      endTime: "eventEnd",
    });
  });

  it("all-day events may end on their own date or later, never before", () => {
    expect(eventTimeProblem("2026-12-05", "2026-12-05")).toBeNull();
    expect(eventTimeProblem("2026-12-05", "2026-12-07")).toBeNull();
    expect(eventTimeProblem("2026-12-05", "2026-12-04")).toBe("eventEnd");
  });

  it("saved drafts may be unfinished but never hold an impossible date or a reversed time", () => {
    expect(eventDraftOk({ type: "event", title: "", start: "" })).toBe(true);
    expect(eventDraftOk({ type: "event", title: "Show", start: "2026-12-05T19:00", end: "2026-12-05T21:00" })).toBe(true);
    expect(eventDraftOk({ type: "event", title: "Show", start: "2026-13-01" })).toBe(false);
    expect(eventDraftOk({ type: "event", title: "Show", start: "2026-12-05T19:00", end: "2026-12-05T18:00" })).toBe(false);
    expect(eventDraftOk({ type: "event", title: "Show", start: "", end: "2026-12-05T18:00" })).toBe(false);
    expect(eventDraftOk({ type: "website", url: "" })).toBe(true);
  });
});
