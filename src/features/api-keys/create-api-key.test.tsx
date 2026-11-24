// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { CreateApiKey } from "./create-api-key";

const issueApiKey = vi.fn();
vi.mock("@/server/actions/api-keys", () => ({ issueApiKey: () => issueApiKey() }));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);
const t = messages.apiKeys;
const KEY = "hqk_AbCdEfGhIjKl_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

/* HEY-153: the full key is shown once, from the creation response, and cleared for good on Done. */
describe("CreateApiKey (HEY-153)", () => {
  it("shows the new key with Copy and the once-only warning; Done clears it", async () => {
    issueApiKey.mockResolvedValue({ ok: true, data: { key: KEY, prefix: "hqk_AbCdEfGhIjKl", createdAt: "2026-11-24T00:00:00.000Z" } });
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CreateApiKey />
      </NextIntlClientProvider>,
    );
    expect(document.body.textContent).not.toContain(KEY);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.create })));
    expect(document.querySelector("[data-slot=api-key-value]")?.textContent).toBe(KEY);
    expect(screen.getByText(t.once)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.copy })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.done }));
    expect(document.body.textContent).not.toContain(KEY);
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.create })).toBeTruthy();
  });
});
