// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../../messages/en.json";
import {
  sampleHostedContent,
  type AppsContent,
  type BusinessContent,
  type CouponContent,
  type HostedContent,
  type ProductContent,
} from "@/entities/qr";
import { publicHostedContent } from "@/server/qr/hosted";
import { HostedPage } from "./hosted-page";

/* Design 11.0: what a visitor's page shows for each state; nothing that isn't there in the data. */
const page = (content: HostedContent, extra: Partial<Parameters<typeof HostedPage>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <HostedPage content={content} mode="public" reportHref="/p/abc/report" now={new Date("2026-11-25T19:00:00Z")} {...extra} />
    </NextIntlClientProvider>,
  );
afterEach(cleanup);

describe("public hosted pages", () => {
  it("menu: sections in the owner's order, with chips that jump to them", () => {
    page(sampleHostedContent("menu"));
    const chips = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("#menu-"));
    expect(chips.map((c) => c.textContent)).toEqual(["Breakfast", "Coffee", "Sweets"]);
    expect(screen.getByText("$4.50")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Report this page" }).getAttribute("href")).toBe("/p/abc/report");
  });

  it("coupon expired: Offer ended and the terms stay; the code and redemption link are gone", () => {
    const c = { ...(sampleHostedContent("coupon") as CouponContent), expires: "2026-11-01" };
    page(publicHostedContent(c, "abc", new Date("2026-11-25T12:00:00Z")));
    expect(screen.getByText("Offer ended")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText(/One code per person/)).toBeTruthy();
    expect(screen.queryByText("FERN20")).toBeNull();
    expect(screen.queryByText("Copy code")).toBeNull();
    expect(screen.queryByText("Redeem online")).toBeNull();
  });

  it("coupon valid: code with Copy and the redemption link", () => {
    page(sampleHostedContent("coupon"));
    expect(screen.getByText("FERN20")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Redeem online/ }).getAttribute("href")).toBe("https://reyes.studio/classes");
  });

  it("business phone-only: only Call, and today's status in the business's time zone", () => {
    const b = { ...(sampleHostedContent("business") as BusinessContent), address: "", website: "", timeZone: "UTC" };
    page(b);
    const actions = screen.getAllByRole("link").map((a) => a.textContent);
    expect(actions).toEqual(["Call", "Report this page"]);
    expect(screen.getByText("Closed now")).toBeTruthy(); // Wed 19:00 UTC, open until 18:00
    expect(document.querySelector('[aria-current="date"]')?.textContent).toContain("Wed");
  });

  it("apps fallback: only the configured store's button", () => {
    const a = { ...(sampleHostedContent("apps") as AppsContent), android: "" };
    page(a);
    expect(screen.getByText("App Store")).toBeTruthy();
    expect(screen.queryByText("Google Play")).toBeNull();
  });

  it("apps on a computer: both stores and the QR for the same short link", () => {
    page(sampleHostedContent("apps"), { desktop: true, desktopQr: <svg data-testid="qr" /> });
    expect(screen.getByText("Scan with your phone")).toBeTruthy();
    expect(screen.getByTestId("qr")).toBeTruthy();
  });

  it("product: the button opens the validated link and shows its host", () => {
    const p = sampleHostedContent("product") as ProductContent;
    page(p);
    expect(screen.getByRole("link", { name: /Buy now/ }).getAttribute("href")).toBe("https://reyes.studio/shop/speckled-mug");
    expect(screen.getByText("Opens reyes.studio")).toBeTruthy();
    expect(screen.getByText("$38")).toBeTruthy();
  });

  it("pdf: Open PDF and Download only for a ready file", () => {
    const pdf = {
      ...sampleHostedContent("pdf"),
      file: { asset: "/p/abc/a/f1?name=s.pdf", name: "s.pdf", bytes: 2308, pages: 2 },
    } as HostedContent;
    page(pdf);
    expect(screen.getByRole("link", { name: /Open PDF/ }).getAttribute("href")).toBe("/p/abc/a/f1?name=s.pdf");
    expect(screen.getByRole("link", { name: /Download/ }).getAttribute("href")).toBe("/p/abc/a/f1?name=s.pdf&download=1");
    expect(screen.getByText("2 pages · 2 KB")).toBeTruthy();
    cleanup();
    page(pdf, { pdfWaiting: true });
    expect(screen.queryByText("Open PDF")).toBeNull();
  });

  it("the editor preview never navigates", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <HostedPage content={sampleHostedContent("product")} mode="preview" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
