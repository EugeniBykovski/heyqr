// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { PaymentInfo } from "./payment-info";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));
afterEach(cleanup);
const show = (support: string | null, price?: string) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <PaymentInfo price={price} support={support} />
    </NextIntlClientProvider>,
  );

/* HEY-109: what a buyer is told before going to Stripe, with nothing shown that isn't confirmed. */
describe("payment explanation", () => {
  it("one-time price, Stripe checkout, receipt in Billing, the support contact, Terms and Privacy", () => {
    show("help@example.test", "$4.99");
    expect(screen.getByRole("heading", { name: "How payment works" })).toBeInTheDocument();
    expect(screen.getByText(/one-time payment of \$4\.99 per code/)).toBeInTheDocument();
    expect(screen.getByText(/isn’t a subscription and nothing renews/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe’s secure checkout page/)).toBeInTheDocument();
    expect(screen.getByText(/under Billing, next to the purchase/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "help@example.test" })).toHaveAttribute("href", "mailto:help@example.test");
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute("href", "mailto:help@example.test");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });

  it("without a confirmed contact: no support line or link, and no placeholder", () => {
    const { container } = show(null, "$4.99");
    expect(screen.queryByRole("link", { name: "Support" })).toBeNull();
    expect(container.textContent).not.toMatch(/Email|@|support/i);
    expect(screen.getByRole("link", { name: "Terms" })).toBeInTheDocument();
  });
});
