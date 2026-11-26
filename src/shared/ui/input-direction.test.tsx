// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, QrPreview } from "@/entities/qr";
import { Input } from "./input";

afterEach(cleanup);

/* HEY-192: in Arabic the page is right to left; addresses and the printed artwork are not. */
describe("left-to-right islands in a right-to-left page (HEY-192)", () => {
  it("web, email and phone fields read left to right; other text follows the page", () => {
    render(
      <div dir="rtl">
        <Input aria-label="url" type="url" />
        <Input aria-label="url mode" inputMode="url" />
        <Input aria-label="email" type="email" />
        <Input aria-label="tel" inputMode="tel" />
        <Input aria-label="name" />
        <Input aria-label="forced" type="url" dir="rtl" />
      </div>,
    );
    for (const name of ["url", "url mode", "email", "tel"]) expect(screen.getByLabelText(name)).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("name")).not.toHaveAttribute("dir");
    expect(screen.getByLabelText("forced")).toHaveAttribute("dir", "rtl");
  });

  it("the QR preview (the printed artwork, caption included) never mirrors", () => {
    render(
      <div dir="rtl">
        <QrPreview
          layout={designToLayout({ ...DEFAULT_DESIGN, preset: "horizontal", caption: "View portfolio" })}
          value="https://example.com"
          label="Preview"
        />
      </div>,
    );
    expect(screen.getByRole("img", { name: "Preview" })).toHaveAttribute("dir", "ltr");
  });
});
