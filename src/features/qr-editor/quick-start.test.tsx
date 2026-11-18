// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { DEFAULT_DESIGN } from "@/entities/qr";
import { QuickStart } from "./quick-start";
import { writeDraft } from "./use-draft";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
  useRouter: () => ({ push }),
}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));

const KEY = "heyqr:draft:v1";
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null");
const renderHome = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <QuickStart copy={null} />
    </NextIntlClientProvider>,
  );
const tab = (name: string) => screen.getByRole("button", { name });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});
afterEach(cleanup);

describe("Homepage quick builder (HEY-16)", () => {
  it("switches Website, Wi-Fi and Contact in place and keeps each tab's values", () => {
    renderHome();
    type("Website address", "littlefern.cafe/menu");

    fireEvent.click(tab("Wi-Fi"));
    expect(tab("Wi-Fi")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Website address")).toBeNull();
    expect(screen.getByText("Wi-Fi · live preview")).toBeInTheDocument();
    type("Network name", "Little Fern Guest");

    fireEvent.click(tab("Contact"));
    expect(screen.getByLabelText("First name", { exact: false })).toBeInTheDocument();

    fireEvent.click(tab("Website"));
    expect(screen.getByLabelText("Website address")).toHaveValue("littlefern.cafe/menu");
    fireEvent.click(tab("Wi-Fi"));
    expect(screen.getByLabelText("Network name")).toHaveValue("Little Fern Guest");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the user on the homepage with the editor's error when the active form is invalid", () => {
    renderHome();
    fireEvent.click(tab("Wi-Fi"));
    type("Network name", "Little Fern Guest");
    type("Password", "abc");
    fireEvent.click(screen.getByRole("button", { name: /Continue designing/ }));
    expect(screen.getByText("WPA passwords have at least 8 characters.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it("saves a valid draft through browser storage and opens Design, with no QR data in the URL", () => {
    renderHome();
    fireEvent.click(tab("Wi-Fi"));
    type("Network name", "Little Fern Guest");
    type("Password", "fern-latte-7");
    fireEvent.click(screen.getByRole("button", { name: "Forest" }));
    fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "Free Wi-Fi" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue designing/ }));

    expect(push).toHaveBeenCalledWith("/create?step=design");
    expect(stored()).toMatchObject({
      schemaVersion: 1,
      model: "static",
      fg: "#1F5C45",
      caption: "Free Wi-Fi",
      content: { type: "wifi", ssid: "Little Fern Guest", password: "fern-latte-7" },
    });
  });

  it("opens the Type step from More + with the current draft", () => {
    renderHome();
    fireEvent.click(tab("Contact"));
    type("First name", "Ana");
    fireEvent.click(tab("More +"));
    expect(push).toHaveBeenCalledWith("/create?step=type");
    expect(stored()).toMatchObject({ content: { type: "contact", firstName: "Ana" } });
  });

  it("sends a restored draft of another type that still needs input to Content", async () => {
    writeDraft({ ...DEFAULT_DESIGN, content: { type: "text", text: "" } });
    renderHome();
    await act(async () => {});
    expect(screen.getByText(/Your draft is a Text code/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue designing/ }));
    expect(push).toHaveBeenCalledWith("/create?step=content");
  });
});
