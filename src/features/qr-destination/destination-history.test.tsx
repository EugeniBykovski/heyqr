// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { DestinationHistory } from "./destination-history";

afterEach(cleanup);
const when = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const show = (entries: Parameters<typeof DestinationHistory>[0]["entries"]) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DestinationHistory entries={entries} />
    </NextIntlClientProvider>,
  );

/* HEY-125: QR details lists the recorded changes as stored (the server orders them, most recent first). */
describe("DestinationHistory", () => {
  it("lists each change: its time, the new address and the previous one, in the given order", () => {
    show([
      { id: 2, previousUrl: "http://b.example.test/menu?x=1#y", newUrl: "https://c.example.test/", changedAt: "2026-11-23T18:45:00.000Z" },
      {
        id: 1,
        previousUrl: "https://a.example.test/menu",
        newUrl: "http://b.example.test/menu?x=1#y",
        changedAt: "2026-11-23T18:30:00.000Z",
      },
    ]);
    expect(screen.getByRole("heading", { name: "Change history" })).toBeTruthy();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      `${when("2026-11-23T18:45:00.000Z")}Changed to https://c.example.test/from http://b.example.test/menu?x=1#y`,
      `${when("2026-11-23T18:30:00.000Z")}Changed to http://b.example.test/menu?x=1#yfrom https://a.example.test/menu`,
    ]);
    expect(items[0]?.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-23T18:45:00.000Z");
  });

  it("shows nothing when no change is recorded (older codes keep only their last change, shown above it)", () => {
    const { container } = show([]);
    expect(container.textContent).toBe("");
  });
});
