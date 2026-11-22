// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";

const social = vi.fn();
let session: unknown = null;
vi.mock("@/shared/lib/auth-client", () => ({ authClient: { signIn: { social: (...a: unknown[]) => social(...a) } } }));
vi.mock("@/server/auth", () => ({ getSession: async () => session }));
vi.mock("@/i18n/server", () => ({ resolveLocale: async (p: Promise<{ locale: string }>) => (await p).locale }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "auth") => createTranslator({ locale: "en", messages, namespace }),
}));
const redirect = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
  Link: ({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest} />,
}));

const { default: SignInPage } = await import("./page");
const { safeReturnPath } = await import("@/features/auth/return-path");
const NEXT = "/create?resume=1&format=png&res=300";

async function open(query: Record<string, string>, locale = "en") {
  const page = (await SignInPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  } as Parameters<typeof SignInPage>[0])) as ReactElement;
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {page}
    </NextIntlClientProvider>,
  );
}
const google = () => screen.getByRole("button", { name: /Continue with Google/ });

beforeEach(() => {
  session = null;
  social.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

/* HEY-72: a guest who cancels Google sign-in comes back to HeyQR with the draft and a retry, never a dead end. */
describe("sign-in return paths (HEY-72)", () => {
  it("sends a canceled or failed Google sign-in back to this page with the same return target", async () => {
    await open({ next: NEXT });
    fireEvent.click(google());
    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: NEXT,
      errorCallbackURL: `/sign-in?next=${encodeURIComponent(NEXT)}`,
    });
  });

  it("keeps the locale on both return URLs", async () => {
    await open({ next: "/pricing" }, "pl");
    fireEvent.click(google());
    expect(social).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: "/pl/pricing", errorCallbackURL: `/pl/sign-in?next=${encodeURIComponent("/pricing")}` }),
    );
  });

  it("after a cancellation says the draft is kept, offers a retry and a way back to the design", async () => {
    await open({ next: NEXT, error: "access_denied" });
    expect(screen.getByRole("status").textContent).toMatch(/canceled\. Your design is still saved in this browser/);
    expect(screen.getByRole("link", { name: "Back to my design" }).getAttribute("href")).toBe("/create?step=design");
    fireEvent.click(google()); // retry
    expect(social).toHaveBeenCalledTimes(1);
  });

  it("any other callback error is an alert; an unexpected value is never shown", async () => {
    await open({ next: "/dashboard", error: "state_mismatch" });
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.incomplete.plain);
    expect(screen.queryByRole("link", { name: "Back to my design" })).toBeNull();
    cleanup();
    await open({ next: "/dashboard", error: "<script>" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an off-site return target falls back to the dashboard", async () => {
    await open({ next: "//evil.example/x" });
    fireEvent.click(google());
    expect(social).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: "/dashboard" }));
  });

  it("the button is usable again when Back from Google restores the page from the back/forward cache", async () => {
    social.mockReturnValue(new Promise(() => {})); // the browser is leaving for Google
    await open({ next: NEXT });
    fireEvent.click(google());
    expect(google()).toHaveProperty("disabled", true);
    act(() => void window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(google()).toHaveProperty("disabled", false);
  });

  it("a signed-in visitor goes straight to the return target", async () => {
    session = { user: { id: "u" } };
    await open({ next: NEXT });
    expect(redirect).toHaveBeenCalledWith({ href: NEXT, locale: "en" });
  });
});

/* HEY-73: return destinations are limited to the app's own routes, including the signed-in redirect. */
describe("sign-in return destinations (HEY-73)", () => {
  it.each([
    ["/create?resume=1&format=svg&transparent=1", "/create?resume=1&format=svg&transparent=1"],
    ["/edit/abc?layout=l1", "/edit/abc?layout=l1"],
    ["/print?qr=q&layout=l", "/print?qr=q&layout=l"],
    ["/dashboard/trial", "/dashboard/trial"],
    ["/pricing", "/pricing"],
    ["/\\evil.example/x", "/dashboard"],
    ["/\t/evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["https://evil.example/create", "/dashboard"],
    ["/api/auth/sign-out", "/dashboard"],
    ["/create/../api/auth/sign-out", "/dashboard"],
    ["/creative", "/dashboard"],
  ])("%s → %s", (next, expected) => {
    expect(safeReturnPath(next)).toBe(expected);
  });

  it("a signed-in visitor is never redirected off the app", async () => {
    session = { user: { id: "u" } };
    redirect.mockClear();
    await open({ next: "/\\evil.example/x" });
    expect(redirect).toHaveBeenCalledWith({ href: "/dashboard", locale: "en" });
  });
});

describe("OAuth errors without a return target (HEY-73)", () => {
  it("a repeated cancel (state already used) offers the retry back into the draft", async () => {
    await open({ error: "state_mismatch" });
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.incomplete.draft);
    expect(screen.getByRole("link", { name: "Back to my design" })).toBeTruthy();
    fireEvent.click(google());
    expect(social).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: "/create?resume=1",
        errorCallbackURL: `/sign-in?next=${encodeURIComponent("/create?resume=1")}`,
      }),
    );
  });
});
