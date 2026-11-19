// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { CurrencyChoice } from "./currency-choice";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Show prices in (design 4.8 / 7.1)", () => {
  it("the charged currency shows no notice; another one says plainly that checkout is in the charged currency", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CurrencyChoice charged="USD" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "GBP" }));
    expect(screen.getByRole("status")).toHaveTextContent("Prices in GBP aren’t available yet. HeyQR charges in USD");
    expect(window.localStorage.getItem("heyqr:display-currency")).toBe("GBP");
    fireEvent.click(screen.getByRole("button", { name: "USD" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
