// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { ScansChart } from "./scans-chart";

// A viewer (or server) west of UTC: a UTC day's midnight is the previous evening there.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages: en, namespace: namespace as "qr.scansCard" }),
  getFormatter: async () => createFormatter({ locale: "en", timeZone: "America/Los_Angeles" }),
}));
afterEach(cleanup);

/* HEY-147: per-QR daily scans, oldest first, zero days included, each labelled with its own UTC day. */
describe("ScansChart (HEY-147)", () => {
  it("labels each UTC day as itself, in order, with zero days shown", async () => {
    const days = [
      { day: "2026-11-28", count: 0 },
      { day: "2026-11-29", count: 3 },
      { day: "2026-11-30", count: 0 },
      { day: "2026-12-01", count: 2 },
    ];
    render(await ScansChart({ days }));
    const rows = [...document.querySelectorAll("table tr")].map((r) => [
      r.querySelector("th")?.textContent,
      r.querySelector("td")?.textContent,
    ]);
    expect(rows).toEqual([
      ["Nov 28", "0"],
      ["Nov 29", "3"],
      ["Nov 30", "0"],
      ["Dec 1", "2"],
    ]);
    // The period's total and today's count.
    expect(document.body.textContent).toContain("5");
  });

  it("HEY-148: Total is the sum of the days shown, Today is the last day", async () => {
    render(
      await ScansChart({
        days: [
          { day: "2026-11-30", count: 4 },
          { day: "2026-12-01", count: 0 },
          { day: "2026-12-02", count: 2 },
        ],
      }),
    );
    const stats = [...document.querySelectorAll("figcaption b")].map((b) => b.textContent);
    expect(stats).toEqual(["6", "2"]);
  });

  it("HEY-148: before the first scan, the designed empty state; with only earlier scans, a period-specific one", async () => {
    const zeros = [
      { day: "2026-12-01", count: 0 },
      { day: "2026-12-02", count: 0 },
    ];
    render(await ScansChart({ days: zeros }));
    expect(document.querySelector("[data-slot=scans-empty]")?.textContent).toBe(en.qr.scansCard.emptyTitle);
    cleanup();
    render(await ScansChart({ days: zeros, earlierScans: true }));
    expect(document.querySelector("[data-slot=scans-empty]")?.textContent).toBe(en.qr.scansCard.periodEmptyTitle);
    expect([...document.querySelectorAll("figcaption b")].map((b) => b.textContent)).toEqual(["0", "0"]);
  });
});
