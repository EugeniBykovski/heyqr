// @vitest-environment jsdom
import { encodePayload, type QrContent } from "@heyqr/qr-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { isContentComplete } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { ContentForm } from "./content-form";
import { contentErrors } from "./content-validation";

afterEach(cleanup);

let latest: QrContent = { type: "event", title: "", start: "" };
function Harness({ initial }: { initial: QrContent }) {
  const [content, setContent] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ContentForm
        content={content}
        errors={contentErrors(content)}
        onChange={(next) => {
          latest = next;
          setContent(next);
        }}
      />
    </NextIntlClientProvider>
  );
}
const open = (initial: QrContent) => {
  latest = initial;
  return render(<Harness initial={initial} />);
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Event: one date, then start and end times (design 1.14)", () => {
  it("date and times build the event's start and end; the code holds a timed VEVENT", () => {
    open({ type: "event", title: "Spring show", start: "" });
    type("Date", "2026-12-05");
    expect(latest).toEqual({ type: "event", title: "Spring show", start: "2026-12-05" });
    type("Starts", "18:30");
    type("Ends", "21:00");
    expect(latest).toEqual({ type: "event", title: "Spring show", start: "2026-12-05T18:30", end: "2026-12-05T21:00" });
    expect(encodePayload(latest)).toContain("DTSTART:20261205T183000");
    expect(encodePayload(latest)).toContain("DTEND:20261205T210000");
    // A new date keeps the times.
    type("Date", "2026-12-06");
    expect(latest).toMatchObject({ start: "2026-12-06T18:30", end: "2026-12-06T21:00" });
    // Clearing the end time removes the end.
    type("Ends", "");
    expect(latest).toEqual({ type: "event", title: "Spring show", start: "2026-12-06T18:30" });
  });

  it("times typed before the date are kept and applied when the date is chosen", () => {
    open({ type: "event", title: "Spring show", start: "" });
    type("Starts", "10:00");
    expect(latest).toMatchObject({ start: "" });
    expect(isContentComplete(latest)).toBe(false);
    expect(screen.getByLabelText("Starts")).toHaveValue("10:00");
    type("Date", "2026-12-05");
    expect(latest).toMatchObject({ start: "2026-12-05T10:00" });
    expect(isContentComplete(latest)).toBe(true);
  });

  it("a date without times is an all-day event (VALUE=DATE, exclusive end the next day)", () => {
    open({ type: "event", title: "Open day", start: "" });
    type("Date", "2026-12-31");
    const ics = encodePayload(latest);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).not.toMatch(/DTSTART:\d{15}/);
  });

  it("an event saved with date-time fields (before this change) opens with its date and times", () => {
    open({ type: "event", title: "Talk", start: "2026-03-01T09:15", end: "2026-03-01T10:00", place: "Hall B" });
    expect(
      [screen.getByLabelText("Date"), screen.getByLabelText("Starts"), screen.getByLabelText("Ends")].map(
        (f) => (f as HTMLInputElement).value,
      ),
    ).toEqual(["2026-03-01", "09:15", "10:00"]);
    expect(encodePayload({ type: "event", title: "Talk", start: "2026-03-01T09:15", end: "2026-03-01T10:00" })).toContain(
      "DTSTART:20260301T091500",
    );
  });

  it("without a date the step stops at the date field", () => {
    open({ type: "event", title: "Talk", start: "" });
    expect(contentErrors(latest)).toMatchObject({ start: "eventStart" });
  });
});

describe("Text: length hint (design 1.5)", () => {
  it("counts characters against 300, keeps newlines, and stops typing at 300", () => {
    open({ type: "text", text: "Studio hours:\nMon–Fri, 9 to 6." });
    expect(screen.getByText("30 of 300 characters. Short text makes a simpler, easier-to-scan code.")).toBeTruthy();
    const field = screen.getByLabelText("Text");
    expect(field).toHaveAttribute("maxLength", "300");
    expect(field.getAttribute("aria-describedby")).toContain("content-text-count");
    type("Text", "Ring the bell\ntwice");
    expect(latest).toEqual({ type: "text", text: "Ring the bell\ntwice" });
  });

  it("an older longer text stays as it is (the limit only stops new typing)", () => {
    const long = "x".repeat(320);
    open({ type: "text", text: long });
    expect(screen.getByLabelText("Text")).toHaveAttribute("maxLength", "320");
    expect(screen.getByText(/^320 of 300 characters/)).toBeTruthy();
  });
});

describe("After scanning shows the event's date and times", () => {
  it("in the viewer's language, as entered (no time-zone shift)", async () => {
    const { ContentPreview } = await import("./content-preview");
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Los_Angeles">
        <ContentPreview
          content={{ type: "event", title: "Spring show", start: "2026-12-05T18:30", end: "2026-12-05T21:00" }}
          mode="static"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("figure").textContent).toContain("Sat, Dec 5, 2026 · 6:30 PM–9:00 PM");
  });
});
