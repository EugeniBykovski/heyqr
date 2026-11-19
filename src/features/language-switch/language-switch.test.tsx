// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "@/i18n/locales";
import messages from "../../../messages/en.json";
import { LanguageSwitch, matchesLanguage } from "./language-switch";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/pricing" }));
afterEach(cleanup);

describe("language switch (design 1.13)", () => {
  it("lists the 21 languages, including Ukrainian and Belarusian, and finds them by native or English name, accents ignored", () => {
    expect(LOCALES).toHaveLength(21);
    const find = (q: string) => LOCALES.filter((l) => matchesLanguage(l, q)).map((l) => l.code);
    expect(find("укр")).toEqual(["uk"]);
    expect(find("Belarus")).toEqual(["be"]);
    expect(find("espanol")).toEqual(["es"]);
    expect(find("AR")).toContain("ar");
    expect(find("")).toHaveLength(21);
  });

  it("opens a searchable panel; choosing a language keeps the page; the current one is marked", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LanguageSwitch />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    expect(screen.getByRole("dialog", { name: "Choose language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /English/, pressed: true })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search languages" }), { target: { value: "zzz" } });
    expect(screen.getByRole("status")).toHaveTextContent("No language matches “zzz”.");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search languages" }), { target: { value: "укр" } });
    fireEvent.click(screen.getByRole("button", { name: /Українська/ }));
    expect(replace).toHaveBeenCalledWith("/pricing", { locale: "uk" });
  });
});
