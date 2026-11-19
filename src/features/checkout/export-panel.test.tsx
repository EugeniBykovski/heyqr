// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, presetSize } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { ExportPanel } from "./export-panel";

vi.mock("@/server/actions/qr", () => ({ startCheckout: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const renderPanel = (layout: ReturnType<typeof designToLayout>) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ExportPanel qrCodeId="q1" layoutId="l1" layout={layout} model="static" entitled price={{ cents: 499, currency: "USD" }} />
    </NextIntlClientProvider>,
  );
const href = () => screen.getByRole("link", { name: /Download/ }).getAttribute("href");

describe("PNG resolution on the export page (HEY-37)", () => {
  it("screen layouts offer 1×–8× within the limits, show the PNG size and pass the scale to the download", () => {
    renderPanel(designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me", size: presetSize(1920, 1080) }));
    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .concat(screen.getAllByRole("button", { pressed: true }))
        .map((b) => b.textContent)
        .sort(),
    ).toEqual(["1×", "2×", "4×"]);
    expect(screen.getByText(/3840 × 2160 px · larger sizes exceed 8192 px/)).toBeInTheDocument();
    expect(href()).toBe("/api/export/l1?format=png&scale=2");
    fireEvent.click(screen.getByRole("button", { name: "4×" }));
    expect(screen.getByText(/7680 × 4320 px/)).toBeInTheDocument();
    expect(href()).toBe("/api/export/l1?format=png&scale=4");
  });

  it("print layouts offer 300/600/1200 dpi and pass the DPI; SVG downloads carry no resolution", () => {
    renderPanel(
      designToLayout({ ...DEFAULT_DESIGN, preset: "frame", frameStyle: "bar", size: { unit: "mm", qr: 40, width: 40, height: 40 } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "600 dpi" }));
    expect(screen.getByText("1077 × 1361 px")).toBeInTheDocument();
    expect(href()).toBe("/api/export/l1?format=png&dpi=600");
    fireEvent.click(screen.getByLabelText(/SVG/));
    expect(screen.queryByText("Resolution")).toBeNull();
    expect(href()).toBe("/api/export/l1?format=svg");
  });
});
