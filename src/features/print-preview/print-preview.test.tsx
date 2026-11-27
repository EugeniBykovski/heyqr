// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, printSizes } from "@/entities/qr";

vi.mock("@/i18n/navigation", () => ({ Link: (p: { children: unknown }) => p.children, useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/server/actions/billing", () => ({ takeIncludedPrintPack: vi.fn() }));
vi.mock("@/server/actions/qr", () => ({ startPrintPackCheckout: vi.fn() }));
const { PrintPreview } = await import("./print-preview");

/*
 * HEY-196 / Handoff · Commerce §3: a Print Pack file is prepared before it downloads. When preparing fails the person
 * stays on Print Preview with "Your payment and settings are safe" and Try again; the retry downloads on the same
 * Print Pack (no checkout is started).
 */
const layout = designToLayout({
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Menu",
  size: { unit: "mm", qr: 40, width: 50, height: 62 },
});
const preview = {
  svg: "<svg/>",
  sizes: printSizes(layout, DEFAULT_PRINT_SETTINGS),
  colors: [],
  logo: null,
  warnings: [],
  renderKey: "rk_test_1234",
  scanOk: true,
  entitled: true,
  unlocked: true,
  forSale: true,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Print Pack downloads (HEY-196)", () => {
  it("a failed preparation shows the safe-payment message and Try again; the retry downloads without a new purchase", async () => {
    const calls: string[] = [];
    let prepares = 0;
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/print/preview") return new Response(JSON.stringify(preview), { status: 200 });
      prepares += 1;
      return prepares === 1 ? new Response("{}", { status: 500 }) : Response.json({ ready: true, name: "x.pdf" }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PrintPreview
          qrCodeId="q1"
          layoutId="l1"
          layout={layout}
          name="Menu"
          layoutName="Card"
          initial={DEFAULT_PRINT_SETTINGS}
          price={{ cents: 299, currency: "USD" }}
          back={{ href: "/dashboard", label: "Back" }}
          designHref="/edit/q1"
          entitled
          forSale
        />
      </NextIntlClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    const pdf = await screen.findByRole("link", { name: /Download print PDF/ });
    fireEvent.click(pdf);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/Your payment and settings are safe/);
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // HEY-197: the prepared file is ready under the server's name; the person's own click is the download.
    const readyLink = await screen.findByRole("link", { name: /Download PDF/ });
    expect(readyLink.textContent).toMatch(/Ready · x\.pdf/);
    expect(readyLink.getAttribute("download")).toBe("x.pdf");
    expect(readyLink.getAttribute("href")).toMatch(/^\/api\/print\/files\/l1\?file=pdf&key=rk_test_1234&.*nav=1/);
    const prepared = calls.filter((u) => u.includes("prepare=1"));
    expect(prepared).toHaveLength(2);
    for (const u of prepared) expect(u).not.toContain("nav=1");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(readyLink);
    const done = await screen.findByRole("link", { name: /Download again/ });
    expect(done.textContent).toMatch(/Downloaded · x\.pdf/);
    // Downloading again is the same link: nothing is prepared or bought again.
    expect(calls.filter((u) => u.includes("prepare=1"))).toHaveLength(2);
  });
});
