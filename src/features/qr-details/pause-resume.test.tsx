// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import ru from "../../../messages/ru.json";
import { PauseResume } from "./pause-resume";

const pauseDynamic = vi.fn();
const resumeDynamic = vi.fn();
vi.mock("@/server/actions/billing", () => ({
  pauseDynamic: (...a: unknown[]) => pauseDynamic(...a),
  resumeDynamic: (...a: unknown[]) => resumeDynamic(...a),
}));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(cleanup);
beforeEach(() => {
  for (const f of [pauseDynamic, resumeDynamic, refresh, toast.success, toast.error]) f.mockReset();
});
const t = messages.qr.details.pause;
const show = (paused: boolean, locale: "en" | "ru" = "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? messages : ru} timeZone="UTC">
      <PauseResume qrCodeId="q1" paused={paused} />
    </NextIntlClientProvider>,
  );

/* HEY-127: Pause and Resume on QR details, through the server actions; the page refreshes with the stored status. */
describe("Pause / Resume on QR details", () => {
  it("a live code: Pause calls the action for this code and refreshes", async () => {
    pauseDynamic.mockResolvedValue({ ok: true, data: undefined });
    show(false);
    expect(screen.getByText(t.liveText)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.pause })));
    expect(pauseDynamic).toHaveBeenCalledWith("q1");
    expect(resumeDynamic).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(t.paused, { id: "qr-pause" });
    expect(refresh).toHaveBeenCalled();
  });

  it("a paused code: says so, and Resume turns it back on", async () => {
    resumeDynamic.mockResolvedValue({ ok: true, data: { shortCode: "AbCdEf2" } });
    show(true);
    expect(screen.getByText(t.pausedTitle)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.resume })));
    expect(resumeDynamic).toHaveBeenCalledWith("q1");
    expect(toast.success).toHaveBeenCalledWith(t.resumed, { id: "qr-pause" });
  });

  it("Resume refused: no free slot, or no plan; the page refreshes to the stored state", async () => {
    show(true);
    for (const [error, message] of [
      ["limit", t.limit],
      ["no_allowance", t.noPlan],
      ["failed", t.failed],
    ] as const) {
      resumeDynamic.mockResolvedValueOnce({ ok: false, error });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: t.resume })));
      expect(toast.error).toHaveBeenLastCalledWith(message, { id: "qr-pause" });
    }
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("is localized (Russian)", () => {
    show(false, "ru");
    expect(screen.getByRole("button", { name: ru.qr.details.pause.pause })).toBeInTheDocument();
  });
});
