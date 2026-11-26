// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { DEFAULT_DESIGN } from "@/entities/qr";
import { ExploreTypes } from "./explore-types";
import { useDraft, writeDraft } from "./use-draft";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://www.heyqr.me/r", NEXT_PUBLIC_APP_URL: "https://www.heyqr.me" } }));

const KEY = "heyqr:draft:v1";
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null");
const renderExplore = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ExploreTypes shortLabel="www.heyqr.me/r/preview" />
    </NextIntlClientProvider>,
  );
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  push.mockClear();
  // jsdom has no layout: scrolling the clicked tab into view is a no-op there.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("Explore QR types (design 10.1 / 10.2)", () => {
  it("lists all ten types as tabs, hosted pages first, with Menu selected", () => {
    renderExplore();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Menu",
      "Coupon",
      "Social links",
      "Business",
      "Apps",
      "PDF document",
      "Product",
      "Website",
      "Wi-Fi",
      "Contact card",
    ]);
    expect(tab(/^Menu$/)).toHaveAttribute("aria-selected", "true");
    // Roving tabindex: only the current tab is in the Tab order.
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    // The scrolling row itself is never a Tab stop (Firefox would add one).
    expect(screen.getByRole("tablist").tabIndex).toBe(-1);
    expect(panel()).toHaveAttribute("aria-labelledby", tab(/^Menu$/).id);
  });

  it("Arrow keys, Home and End move the selection and the focus; the panel follows in place", () => {
    renderExplore();
    tab(/^Menu$/).focus();
    fireEvent.keyDown(tab(/^Menu$/), { key: "ArrowRight" });
    expect(tab(/^Coupon$/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Coupon$/)).toHaveFocus();
    expect(within(panel()).getByRole("button", { name: "Create a Coupon QR" })).toBeVisible();
    fireEvent.keyDown(tab(/^Coupon$/), { key: "End" });
    expect(tab(/^Contact card$/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Contact card$/), { key: "ArrowRight" });
    expect(tab(/^Menu$/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Menu$/), { key: "ArrowLeft" });
    expect(tab(/^Contact card$/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(/^Contact card$/), { key: "Home" });
    expect(tab(/^Menu$/)).toHaveAttribute("aria-selected", "true");
  });

  it("only the current type's copy and CTA can be read or reached; the others only hold the panel's height", () => {
    renderExplore();
    fireEvent.click(tab(/^Coupon$/));
    // One CTA in the accessibility tree: the current type's.
    expect(
      within(panel())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Create a Coupon QR"]);
    const hidden = within(panel()).getByText("Create a Menu QR", { exact: false }).closest("[aria-hidden]");
    expect(hidden).toHaveAttribute("inert");
    expect(within(panel()).getByText("Discounts people claim")).toBeVisible();
  });

  it("the CTA opens Content with the type selected (hosted as Dynamic) and keeps the quick-create look", () => {
    writeDraft({ ...DEFAULT_DESIGN, fg: "#1F5C45", pattern: "dot", content: { type: "website", url: "https://littlefern.cafe" } });
    renderExplore();
    fireEvent.click(tab(/^Coupon$/));
    fireEvent.click(within(panel()).getByRole("button", { name: "Create a Coupon QR" }));
    expect(push).toHaveBeenCalledWith("/create?step=content&type=coupon");
    expect(stored()).toMatchObject({ model: "dynamic", fg: "#1F5C45", pattern: "dot", content: { type: "coupon" } });
    // A handover, not a restore: the editor won't announce "We restored your last design".
    const { result } = renderHook(() => useDraft());
    expect(result.current).toMatchObject({ restored: true, handedOff: true });
  });

  it("Create a Website QR keeps the address typed in the quick builder", () => {
    writeDraft({ ...DEFAULT_DESIGN, content: { type: "website", url: "https://littlefern.cafe/menu" } });
    renderExplore();
    fireEvent.click(tab(/^Website$/));
    fireEvent.click(within(panel()).getByRole("button", { name: "Create a Website QR" }));
    expect(push).toHaveBeenCalledWith("/create?step=content&type=website");
    expect(stored()).toMatchObject({ model: "static", content: { type: "website", url: "https://littlefern.cafe/menu" } });
  });
});

describe("draft handover (design 10.1 → editor)", () => {
  it("a draft that was simply left behind is still reported as restored", () => {
    writeDraft({ ...DEFAULT_DESIGN, content: { type: "website", url: "https://littlefern.cafe" } });
    expect(renderHook(() => useDraft()).result.current).toMatchObject({ restored: true, handedOff: false });
  });

  it("the handover counts once: the next visit reports the draft as restored again", () => {
    writeDraft(DEFAULT_DESIGN);
    sessionStorage.setItem("heyqr:draft:handoff", "1");
    const first = renderHook(() => useDraft());
    expect(first.result.current.handedOff).toBe(true);
    first.unmount();
    expect(renderHook(() => useDraft()).result.current.handedOff).toBe(false);
  });
});
