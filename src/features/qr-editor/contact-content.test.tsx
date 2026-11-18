// @vitest-environment jsdom
import type { QrContent } from "@heyqr/qr-core";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { ContentForm } from "./content-form";
import { ContentPreview } from "./content-preview";
import { contentErrors } from "./content-validation";

afterEach(cleanup);

const renderContact = (content: QrContent, showErrors = true) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ContentForm content={content} onChange={() => {}} errors={showErrors ? contentErrors(content) : {}} />
      <ContentPreview content={content} mode="static" />
    </NextIntlClientProvider>,
  );

describe("Contact card form and After scanning (HEY-23)", () => {
  it("follows the design order and marks only title, company and website as optional", () => {
    renderContact({ type: "contact", firstName: "Ana" }, false);
    const ids = [...document.querySelectorAll("input")].map((i) => i.id);
    expect(ids).toEqual([
      "content-firstName",
      "content-lastName",
      "content-title",
      "content-company",
      "content-phone",
      "content-email",
      "content-website",
    ]);
    const optional = [...document.querySelectorAll("label")].filter((l) => l.textContent?.includes("optional")).map((l) => l.htmlFor);
    expect(optional).toEqual(["content-title", "content-company", "content-website"]);
  });

  it("attaches each validation error to its field", () => {
    renderContact({ type: "contact", email: "ana@", phone: "call me", website: "not a site" });
    for (const [field, message] of [
      ["content-firstName", "Add at least a first or last name."],
      ["content-email", "Check the email address"],
      ["content-website", "can’t contain spaces"],
    ] as const) {
      const input = document.getElementById(field);
      expect(input).toHaveAttribute("aria-invalid", "true");
      const describedBy = input?.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(describedBy)?.textContent).toContain(message);
    }
    expect(document.getElementById("content-phone")).toHaveAttribute("aria-invalid", "true");
  });

  it("previews initials, full name, role and the contact rows", () => {
    renderContact({
      type: "contact",
      firstName: "Zoë",
      lastName: "Ковальчук",
      title: "Designer",
      company: "Reyes Studio",
      phone: "+1 415 555 0142",
      email: "zoe@example.com",
      website: "https://example.com/zoe",
    });
    const preview = screen.getByRole("figure");
    expect(preview.textContent).toContain("ZК");
    expect(preview.textContent).toContain("Zoë Ковальчук");
    expect(preview.textContent).toContain("Designer · Reyes Studio");
    expect(preview.textContent).toContain("example.com/zoe");
    expect(preview.textContent).toContain("Add to contacts");
  });
});
