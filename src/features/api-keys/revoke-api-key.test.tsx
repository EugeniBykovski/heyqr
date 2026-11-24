// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { RevokeApiKey } from "./revoke-api-key";

const revokeApiKeyAction = vi.fn();
vi.mock("@/server/actions/api-keys", () => ({ revokeApiKeyAction: (...a: unknown[]) => revokeApiKeyAction(...a) }));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
const t = messages.apiKeys.revoke;

/* HEY-154: Revoke asks first; Cancel changes nothing; confirming revokes that key. */
describe("RevokeApiKey (HEY-154)", () => {
  it("confirmation names the key; Cancel revokes nothing; Revoke key revokes it", async () => {
    revokeApiKeyAction.mockResolvedValue({ ok: true, data: { revokedAt: "2026-11-24T12:00:00.000Z" } });
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RevokeApiKey keyId="k1" prefix="hqk_AbCdEfGhIjKl" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke hqk_AbCdEfGhIjKl" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Revoke hqk_AbCdEfGhIjKl?");
    expect(screen.getByRole("alertdialog").textContent).toContain(t.text);
    fireEvent.click(screen.getByRole("button", { name: t.cancel }));
    expect(revokeApiKeyAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke hqk_AbCdEfGhIjKl" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.confirm })));
    expect(revokeApiKeyAction).toHaveBeenCalledExactlyOnceWith("k1");
    expect(refresh).toHaveBeenCalled();
  });
});
