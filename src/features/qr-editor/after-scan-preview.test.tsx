// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { AfterScanPreview } from "./after-scan-preview";

/* HEY-184 · design 1.6: the Design stage's "QR design | After scan" switch exists for every type. */
afterEach(cleanup);
const intl = (node: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

describe("Design stage · After scan (HEY-184, design 1.6)", () => {
  it("codes that open straight from the code show the phone's own screen", () => {
    const website: EditorDesign = { ...DEFAULT_DESIGN, content: { type: "website", url: "https://anareyes.studio/portfolio" } };
    render(intl(<AfterScanPreview design={website} shortLabel="heyqr.me/r/preview" />));
    expect(screen.getByRole("figure", { name: "After scanning" }).textContent).toContain("anareyes.studio");
  });

  it("hosted types keep their hosted page in the same slot (design 10.7)", () => {
    const menu: EditorDesign = {
      ...DEFAULT_DESIGN,
      model: "dynamic",
      content: {
        type: "menu",
        v: 1,
        name: "Little Fern Café",
        note: "",
        currency: "USD",
        sections: [{ id: "s1", name: "Coffee", dishes: [] }],
      },
    };
    render(intl(<AfterScanPreview design={menu} shortLabel="heyqr.me/r/preview" />));
    expect(screen.getByRole("figure", { name: "After scanning" }).textContent).toContain("Little Fern Café");
  });
});
