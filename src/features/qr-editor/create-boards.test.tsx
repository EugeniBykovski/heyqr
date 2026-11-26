// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { QrContent } from "@heyqr/qr-core";
import messages from "../../../messages/en.json";
import { ContentForm } from "./content-form";
import { ContentPreview } from "./content-preview";

/* HEY-184 · design "1 · Create" (1.3–1.5, 1.14): the phone preview and its rows. */
afterEach(cleanup);
const intl = (node: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);
const EVENT: QrContent = {
  type: "event",
  title: "Spring show",
  start: "2026-12-05T19:00",
  end: "2026-12-05T22:00",
  place: "Reyes Studio, 21 Pier St",
};

describe("design 1 · Create: previews and form rows (HEY-184)", () => {
  it("1.14: an event reads “Add to calendar”, its Date row and “Add event”; long values wrap instead of clipping", () => {
    render(intl(<ContentPreview content={EVENT} mode="static" />));
    const fig = screen.getByRole("figure", { name: "After scanning" });
    expect(within(fig).getByText("Add to calendar")).toBeTruthy();
    expect(within(fig).getByText("Date")).toBeTruthy();
    expect(within(fig).getByText("Add event")).toBeTruthy();
    // The value sat in a right-aligned flex box with `truncate`: a value wider than the row overflowed to the left and
    // lost its first letters ("ec 5, 2026"). It now wraps.
    const value = within(fig).getByText(/Dec 5, 2026/);
    const box = value.closest("span.ms-auto") ?? value;
    expect(box.className).toContain("[overflow-wrap:anywhere]");
    expect(box.className).not.toContain("truncate");
    expect(box.className).not.toContain("justify-end");
  });

  it("1.3–1.5: the preview takes the column's width, so the phone keeps one size for every type", () => {
    for (const content of [
      EVENT,
      { type: "text", text: "Hi" } as QrContent,
      { type: "wifi", ssid: "A", security: "WPA", password: "x" } as QrContent,
    ]) {
      const { unmount } = render(intl(<ContentPreview content={content} mode="static" />));
      expect(screen.getByRole("figure", { name: "After scanning" }).className).toContain("w-full");
      unmount();
    }
  });

  it("1.3 / 1.14 at 390: first and last name, and an event's two times, share a row; other fields span it", () => {
    const cell = (id: string) => (document.getElementById(id)?.closest("div.flex-col") as HTMLElement).className;
    const { unmount } = render(
      intl(<ContentForm content={{ type: "contact", firstName: "", lastName: "" }} onChange={() => {}} errors={{}} />),
    );
    expect(cell("content-firstName")).toMatch(/(^| )col-span-1( |$)/);
    expect(cell("content-lastName")).toMatch(/(^| )col-span-1( |$)/);
    expect(cell("content-title")).toMatch(/(^| )col-span-2( |$)/);
    expect(cell("content-email")).toMatch(/(^| )col-span-2( |$)/);
    unmount();
    render(intl(<ContentForm content={EVENT} onChange={() => {}} errors={{}} />));
    expect(cell("content-startTime")).toMatch(/(^| )col-span-1( |$)/);
    expect(cell("content-endTime")).toMatch(/(^| )col-span-1( |$)/);
    expect(cell("content-title")).toMatch(/(^| )col-span-2( |$)/);
  });
});
