// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import ru from "../../../../messages/ru.json";

let locale: "en" | "ru" = "en";
vi.mock("@/i18n/server", () => ({ resolveLocale: async () => locale }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    const pick = (m: unknown) =>
      ns.split(".").reduce((o, k) => (o as Record<string, unknown>)?.[k], m) as Record<string, string> | undefined;
    return (key: string) => pick(locale === "ru" ? ru : en)?.[key] ?? pick(en)?.[key] ?? key;
  },
}));
const { default: Page, metadata } = await import("./page");
afterEach(cleanup);

const show = async (reason?: string) =>
  render(await Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(reason ? { reason } : {}) } as never));

/* HEY-121 / QR-16.06: the page a short link lands on when it can't redirect. */
describe("/link-unavailable", () => {
  it("is never indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("generic fallback for unknown, deleted, inactive and destination-less codes", async () => {
    await show();
    expect(screen.getByRole("heading", { name: "This link is not active" })).toBeTruthy();
  });

  it("an ended trial: neutral copy that doesn't say the owner paused it or mention plans; the old reason shows the same", async () => {
    for (const reason of ["inactive", "paused"]) {
      const { container } = await show(reason);
      expect(screen.getByRole("heading", { name: "This link isn’t available right now" })).toBeTruthy();
      expect(container.textContent).not.toMatch(/paused|owner|trial|plan|subscri/i);
      cleanup();
    }
  });

  it("is localized", async () => {
    locale = "ru";
    await show("inactive");
    expect(screen.getByRole("heading", { name: "Ссылка сейчас недоступна" })).toBeTruthy();
    cleanup();
    await show();
    expect(screen.getByRole("heading", { name: "Ссылка не активна" })).toBeTruthy();
    locale = "en";
  });
});
