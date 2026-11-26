import { execFileSync } from "node:child_process";
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { decodeSvg } from "../src/node";
import { encodePayload, renderQrSvg, type QrContent } from "../src";

/*
 * HEY-193: an Event code holds a VEVENT that calendar apps import as written. Checked with a real iCalendar parser
 * (ical.js, the one Thunderbird and many web calendars use) and by decoding a rendered code with ZXing.
 */
type Event = Extract<QrContent, { type: "event" }>;
const STYLE = {
  pattern: "square",
  eyeFrame: "square",
  eyeBall: "square",
  colors: { fg: "#0D0D12", eye: "#0D0D12", eyeIn: "#0D0D12", bg: "#FFFFFF" },
} as const;

function parse(payload: string) {
  const event = new ICAL.Event(new ICAL.Component(ICAL.parse(payload)));
  return { event, start: event.startDate, end: event.endDate };
}

describe("Event codes as VEVENT (HEY-193)", () => {
  it("escapes ; , \\ and line breaks in the name and place (RFC 5545 TEXT), so they read back unchanged", () => {
    const content: Event = {
      type: "event",
      title: "Show; part 1, live \\ encore\nDTSTART:19990101T000000",
      start: "2026-12-05T19:00",
      end: "2026-12-05T21:30",
      place: "Reyes Studio, 21 Pier St; back door",
    };
    const payload = encodePayload(content);
    // The line break can't start a new property: there is exactly one DTSTART, the event's own.
    expect(payload.match(/^DTSTART/gm)).toHaveLength(1);
    expect(payload).toContain(String.raw`SUMMARY:Show\; part 1\, live \\ encore\nDTSTART:19990101T000000`);
    const { event } = parse(payload);
    expect(event.summary).toBe(content.title);
    expect(event.location).toBe(content.place);
  });

  it("keeps Unicode in the name and place", () => {
    const content: Event = {
      type: "event",
      title: "Весенний показ ✦ 春のショー 🎨",
      start: "2026-12-05T19:00",
      place: "Café «Fern», Zürich",
    };
    const { event } = parse(encodePayload(content));
    expect([event.summary, event.location]).toEqual([content.title, content.place]);
  });

  it("writes floating local times: 19:00–21:30 stays 19:00–21:30 in any time zone", () => {
    const payload = encodePayload({ type: "event", title: "Spring show", start: "2026-12-05T19:00", end: "2026-12-05T21:30" });
    expect(payload).toContain("DTSTART:20261205T190000");
    expect(payload).toContain("DTEND:20261205T213000");
    expect(payload).not.toMatch(/TZID|\d{6}Z/);
    const { start, end } = parse(payload);
    expect(start.zone?.tzid).toBe("floating");
    expect([start.year, start.month, start.day, start.hour, start.minute]).toEqual([2026, 12, 5, 19, 0]);
    expect([end.hour, end.minute]).toEqual([21, 30]);
    // A calendar in each zone imports it at the same wall-clock time on the same date (a fresh process per zone).
    const script = `import ICAL from "ical.js"; const e = new ICAL.Event(new ICAL.Component(ICAL.parse(${JSON.stringify(payload)}))); const d = e.startDate.toJSDate(); process.stdout.write([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join(","));`;
    for (const TZ of ["Asia/Tokyo", "America/Los_Angeles", "Europe/Warsaw", "UTC"])
      expect(
        execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }),
        TZ,
      ).toBe("2026,12,5,19,0");
  });

  it("writes an all-day event as VALUE=DATE with the next day as its exclusive end", () => {
    const payload = encodePayload({ type: "event", title: "Open studio", start: "2026-12-31" });
    expect(payload).toContain("DTSTART;VALUE=DATE:20261231");
    expect(payload).toContain("DTEND;VALUE=DATE:20270101");
    const { start, end } = parse(payload);
    expect(start.isDate).toBe(true);
    expect([start.year, start.month, start.day, end.year, end.month, end.day]).toEqual([2026, 12, 31, 2027, 1, 1]);
  });

  it("a rendered code decodes (ZXing) to exactly the VEVENT, punctuation and Unicode included", async () => {
    const content: Event = {
      type: "event",
      title: "Spring show; ✦ «live»",
      start: "2026-12-05T19:00",
      end: "2026-12-05T21:00",
      place: "Reyes Studio, 21 Pier St",
    };
    const payload = encodePayload(content);
    expect(await decodeSvg(renderQrSvg(payload, STYLE))).toBe(payload);
    const { event } = parse(payload);
    expect([event.summary, event.location]).toEqual([content.title, content.place]);
  });
});
