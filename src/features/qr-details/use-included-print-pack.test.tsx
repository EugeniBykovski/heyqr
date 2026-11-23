// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { UseIncludedPrintPack } from "./use-included-print-pack";

const takeIncludedPrintPack = vi.fn();
vi.mock("@/server/actions/billing", () => ({ takeIncludedPrintPack: (...a: unknown[]) => takeIncludedPrintPack(...a) }));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(cleanup);
beforeEach(() => {
  takeIncludedPrintPack.mockReset();
  refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <UseIncludedPrintPack qrCodeId="q1" />
    </NextIntlClientProvider>,
  );

/* HEY-105 design 8.4: QR details uses the plan's included Print Pack through the same action as Export. */
describe("Use 1 included Print Pack on QR details", () => {
  it("uses the allowance for this code and refreshes into its files", async () => {
    takeIncludedPrintPack.mockResolvedValue({ ok: true, data: undefined });
    show();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use 1 included Print Pack" })));
    expect(takeIncludedPrintPack).toHaveBeenCalledWith("q1");
    expect(toast.success).toHaveBeenCalledWith(messages.qr.details.pack.includedDone, { id: "pp-included" });
    expect(refresh).toHaveBeenCalled();
  });

  it("none left (used elsewhere meanwhile): says so and refreshes to the current state", async () => {
    takeIncludedPrintPack.mockResolvedValue({ ok: false, error: "no_allowance" });
    show();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use 1 included Print Pack" })));
    expect(toast.error).toHaveBeenCalledWith(messages.qr.details.pack.noneLeft, { id: "pp-included" });
    expect(refresh).toHaveBeenCalled();
  });
});
