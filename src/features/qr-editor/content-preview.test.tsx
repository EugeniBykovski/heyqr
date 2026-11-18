// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { ContentPreview } from "./content-preview";

afterEach(cleanup);

const renderText = (text: string) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ContentPreview content={{ type: "text", text }} mode="static" />
    </NextIntlClientProvider>,
  );

describe("After scanning · Text (HEY-21)", () => {
  it("shows the text exactly as it will be encoded: spaces, empty lines, Cyrillic, emoji and combining marks", () => {
    const text = "  Привет, мир!\n\nCafé ☕ 👩🏽‍💻 — é ñ Ё̈  \nLast line ";
    renderText(text);
    const bubble = document.querySelector(".whitespace-pre-wrap");
    expect(bubble?.textContent).toBe(text);
  });

  it("shows the placeholder for blank text", () => {
    renderText("   \n ");
    expect(screen.getByText("Your text appears here.")).toBeInTheDocument();
  });
});
