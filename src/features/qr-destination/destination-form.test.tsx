// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { DestinationForm, splitScheme } from "./destination-form";

const updateDestination = vi.fn();
vi.mock("@/server/actions/qr", () => ({ updateDestination: (...a: unknown[]) => updateDestination(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => updateDestination.mockReset());

const view = (destination: string) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DestinationForm qrCodeId="q1" destination={destination} shortLink="localhost:3000/r/AbCdEf2" />
    </NextIntlClientProvider>,
  );
const field = () => screen.getByLabelText("New destination") as HTMLInputElement;
const scheme = () => document.querySelector('[data-slot="destination-scheme"]')?.textContent;
const current = () => document.querySelector('[data-slot="destination-current"]')?.textContent?.trim();
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  });
};

/* HEY-119: Change destination keeps the scheme, accepts either one and shows what the server stored. */
describe("DestinationForm (HEY-119)", () => {
  it("splits a scheme off a full address; a bare domain stays as typed", () => {
    expect(splitScheme("http://a.example.test/x")).toEqual({ scheme: "http", rest: "a.example.test/x" });
    expect(splitScheme("HTTPS://a.example.test")).toEqual({ scheme: "https", rest: "a.example.test" });
    expect(splitScheme("a.example.test")).toEqual({ scheme: null, rest: "a.example.test" });
  });

  it("opens with the current scheme: an http:// destination stays http://", () => {
    view("http://old.example.test/menu?x=1#top");
    expect(current()).toBe("http://old.example.test/menu?x=1#top");
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    expect(scheme()).toBe("http://");
    expect(field().value).toBe("old.example.test/menu?x=1#top");
  });

  it("pasting a full https:// or http:// address sets that scheme; saving shows the URL the server stored", async () => {
    view("http://old.example.test/menu");
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "https://new.example.test/menu?table=4#drinks" } });
    expect([scheme(), field().value]).toEqual(["https://", "new.example.test/menu?table=4#drinks"]);
    updateDestination.mockResolvedValue({ ok: true, data: { destination: "https://new.example.test/menu?table=4#drinks" } });
    await submit();
    expect(updateDestination).toHaveBeenCalledWith("q1", "https://new.example.test/menu?table=4#drinks");
    expect(current()).toBe("https://new.example.test/menu?table=4#drinks");
    expect(screen.getByText("Previously http://old.example.test/menu · changed just now")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    expect(scheme()).toBe("https://");
    fireEvent.change(field(), { target: { value: "http://old.example.test/menu" } });
    expect(scheme()).toBe("http://");
    updateDestination.mockResolvedValue({ ok: true, data: { destination: "http://old.example.test/menu" } });
    await submit();
    expect(updateDestination).toHaveBeenLastCalledWith("q1", "http://old.example.test/menu");
    expect(current()).toBe("http://old.example.test/menu");
  });

  it("a bare domain keeps the scheme shown", async () => {
    view("https://old.example.test");
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "bare.example.test/p" } });
    updateDestination.mockResolvedValue({ ok: true, data: { destination: "https://bare.example.test/p" } });
    await submit();
    expect(updateDestination).toHaveBeenCalledWith("q1", "https://bare.example.test/p");
  });

  it("invalid input shows the field error and keeps the current destination; nothing is sent", async () => {
    view("https://old.example.test/menu");
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "not a url" } });
    await submit();
    expect(updateDestination).not.toHaveBeenCalled();
    expect(screen.getByText("Web addresses can’t contain spaces.")).toBeTruthy();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(current()).toBe("https://old.example.test/menu");
  });

  it("an address the server refuses shows its field error and changes nothing", async () => {
    view("https://old.example.test/menu");
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "ok.example.test" } });
    updateDestination.mockResolvedValue({ ok: false, error: "invalid", field: "destination", problem: "invalid" });
    await submit();
    expect(screen.getByText("Check the address. It needs a domain, like yourname.com.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(current()).toBe("https://old.example.test/menu");
  });
});
