// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const { MobileMenu } = await import("./mobile-menu");

afterEach(cleanup);
const items = [
  { href: "/pricing", label: "Pricing" },
  { href: "/developers", label: "API for developers" },
];
const open = () => {
  render(
    <>
      <MobileMenu menuLabel="Menu" primary={{ href: "/create", label: "Create QR code" }} items={items} />
      <button type="button" onClick={pageButton}>
        Page action
      </button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: "Menu" });
  fireEvent.click(trigger);
  return trigger;
};
const pageButton = vi.fn();
const backdrop = () => document.querySelector<HTMLElement>('[data-slot="mobile-menu-backdrop"]');

describe("phone menu (HEY-187)", () => {
  it("opens with a backdrop over the page and locks its scroll", () => {
    open();
    expect(screen.getByRole("navigation", { name: "Menu" })).toBeTruthy();
    expect(backdrop()).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("a tap on the backdrop closes it, returns focus to the button and activates nothing underneath", () => {
    pageButton.mockClear();
    const trigger = open();
    const b = backdrop();
    if (!b) throw new Error("no backdrop");
    fireEvent.click(b);
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(backdrop()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(pageButton).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("");
  });

  it("Escape and the close button close it and return focus to the button", () => {
    const trigger = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("navigation", { name: "Menu" })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
