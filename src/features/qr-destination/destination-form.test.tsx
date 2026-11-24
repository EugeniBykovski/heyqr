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

const view = (destination: string, stored: { previous?: string | null; changedAt?: string | null; revision?: number } = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DestinationForm qrCodeId="q1" destination={destination} shortLink="localhost:3000/r/AbCdEf2" revision={3} {...stored} />
    </NextIntlClientProvider>,
  );
const field = () => screen.getByLabelText("New destination") as HTMLInputElement;
const T = "2026-11-23T18:30:00.000Z";
const T2 = "2026-11-23T18:45:00.000Z";
const when = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const previous = () => document.querySelector('[data-slot="destination-previous"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null;
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
    updateDestination.mockResolvedValue({
      ok: true,
      data: {
        destination: "https://new.example.test/menu?table=4#drinks",
        previousDestination: "http://old.example.test/menu",
        changedAt: "2026-11-23T18:30:00.000Z",
        revision: 4,
      },
    });
    await submit();
    expect(updateDestination).toHaveBeenCalledWith("q1", "https://new.example.test/menu?table=4#drinks", 3);
    expect(current()).toBe("https://new.example.test/menu?table=4#drinks");
    expect(previous()).toBe(`Previously http://old.example.test/menu · changed ${when(T)}`);
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe(T);
    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    expect(scheme()).toBe("https://");
    fireEvent.change(field(), { target: { value: "http://old.example.test/menu" } });
    expect(scheme()).toBe("http://");
    updateDestination.mockResolvedValue({
      ok: true,
      data: {
        destination: "http://old.example.test/menu",
        previousDestination: "https://new.example.test/menu?table=4#drinks",
        changedAt: T2,
        revision: 5,
      },
    });
    await submit();
    // HEY-128: the second edit starts from the revision the first save returned.
    expect(updateDestination).toHaveBeenLastCalledWith("q1", "http://old.example.test/menu", 4);
    expect(current()).toBe("http://old.example.test/menu");
  });

  it("a bare domain keeps the scheme shown", async () => {
    view("https://old.example.test");
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "bare.example.test/p" } });
    updateDestination.mockResolvedValue({
      ok: true,
      data: { destination: "https://bare.example.test/p", previousDestination: "https://old.example.test", changedAt: T, revision: 4 },
    });
    await submit();
    expect(updateDestination).toHaveBeenCalledWith("q1", "https://bare.example.test/p", 3);
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

  it("HEY-123: after a reload it shows the stored previous URL and change time; Saved only after saving here", () => {
    view("https://new.example.test/menu", { previous: "http://old.example.test/menu", changedAt: T });
    expect(previous()).toBe(`Previously http://old.example.test/menu · changed ${when(T)}`);
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("HEY-123: an older row with a known previous URL but no time shows the URL and omits the time", () => {
    view("https://new.example.test/menu", { previous: "https://legacy.example.test", changedAt: null });
    expect(previous()).toBe("Previously https://legacy.example.test");
    expect(document.querySelector("time")).toBeNull();
    cleanup();
    view("https://new.example.test/menu");
    expect(previous()).toBeNull();
  });

  it("HEY-123: saving the same URL, invalid input and Cancel keep the previous URL and time as they were", async () => {
    view("https://new.example.test/menu", { previous: "http://old.example.test/menu", changedAt: T });
    const before = previous();
    // The same address: the server stores nothing new and returns the earlier change.
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    updateDestination.mockResolvedValue({
      ok: true,
      data: {
        destination: "https://new.example.test/menu",
        previousDestination: "http://old.example.test/menu",
        changedAt: T,
        revision: 3,
      },
    });
    await submit();
    expect([current(), previous()]).toEqual(["https://new.example.test/menu", before]);
    // Invalid input: nothing sent, nothing changed.
    updateDestination.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "ftp://files.example.test" } });
    await submit();
    expect(updateDestination).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect([current(), previous()]).toEqual(["https://new.example.test/menu", before]);
    // Cancel after typing a new address.
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: "https://other.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateDestination).not.toHaveBeenCalled();
    expect([current(), previous()]).toEqual(["https://new.example.test/menu", before]);
  });
});

/* HEY-128: a save from a stale destination revision is a conflict; the typed address stays until the owner reloads. */
describe("DestinationForm conflicts (HEY-128)", () => {
  const A = "https://a.example.test/";
  const B = "https://b.example.test/";
  const C = "https://c.example.test/";
  const latest = { destination: B, previousDestination: A, changedAt: T, revision: 4 };
  const conflict = () => document.querySelector('[data-slot="destination-conflict"]');
  const saveButton = () => screen.getByRole("button", { name: "Save destination" }) as HTMLButtonElement;
  const staleSave = async () => {
    view(A, { revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    fireEvent.change(field(), { target: { value: C } });
    updateDestination.mockResolvedValueOnce({ ok: false, error: "conflict", latest });
    await submit();
  };

  it("shows the published URL, keeps the typed address and doesn't save until the latest version is loaded", async () => {
    await staleSave();
    expect(updateDestination).toHaveBeenCalledExactlyOnceWith("q1", C, 3);
    expect(conflict()?.getAttribute("role")).toBe("alert");
    expect(conflict()?.textContent).toContain(messages.qr.dest.conflict.title);
    expect(conflict()?.textContent).toContain(`It now goes to ${B}.`);
    expect(field().value).toBe("c.example.test/");
    // No automatic retry, and Save stays off until the owner loads the latest version.
    expect(saveButton().disabled).toBe(true);
    expect(updateDestination).toHaveBeenCalledTimes(1);
  });

  it("Load latest version: the edit is based on the latest revision; saving C again sends it explicitly", async () => {
    await staleSave();
    fireEvent.click(screen.getByRole("button", { name: messages.qr.dest.conflict.load }));
    expect(conflict()).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(B);
    expect([field().value, saveButton().disabled]).toEqual(["c.example.test/", false]);
    updateDestination.mockResolvedValueOnce({ ok: true, data: { destination: C, previousDestination: B, changedAt: T2, revision: 5 } });
    await submit();
    expect(updateDestination).toHaveBeenLastCalledWith("q1", C, 4);
    expect(current()).toBe(C);
    expect(previous()).toBe(`Previously ${B} · changed ${when(T2)}`);
  });

  it("Cancel after a conflict shows what is published now, and the next edit starts from it", async () => {
    await staleSave();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(current()).toBe(B);
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    expect([field().value, conflict()]).toEqual(["b.example.test/", null]);
    fireEvent.change(field(), { target: { value: C } });
    updateDestination.mockResolvedValueOnce({ ok: true, data: { destination: C, previousDestination: B, changedAt: T2, revision: 5 } });
    await submit();
    expect(updateDestination).toHaveBeenLastCalledWith("q1", C, 4);
  });
});
