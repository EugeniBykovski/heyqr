// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, presetSize } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { ExportSurface, exportFileUrl, fileNameFrom, type ExportSurfaceProps } from "./export-surface";

const startCheckout = vi.fn();
vi.mock("@/server/actions/qr", () => ({ startCheckout: (...a: unknown[]) => startCheckout(...a) }));
const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));
afterEach(cleanup);
beforeEach(() => {
  startCheckout.mockReset();
  refresh.mockReset();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:file"), revokeObjectURL: vi.fn() }));
});

const VALUE = "https://anareyes.studio/portfolio";
const pxLayout = designToLayout({ ...DEFAULT_DESIGN, preset: "caption", caption: "Scan me", size: presetSize(1920, 1080) });
const mmLayout = designToLayout({
  ...DEFAULT_DESIGN,
  preset: "frame",
  frameStyle: "bar",
  size: { unit: "mm", qr: 40, width: 40, height: 40 },
});
const base = {
  title: "Download your code",
  heading: "Portfolio card · Business card",
  value: VALUE,
  model: "static" as const,
  typeLabel: "Website",
  layoutName: "Business card",
  backHref: "/edit/q1?layout=l1",
  initial: {},
  price: { cents: 499, currency: "USD" },
};
const signed = (p: Partial<ExportSurfaceProps> & { layout?: ExportSurfaceProps["layout"]; entitled?: boolean } = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ExportSurface {...base} layout={pxLayout} mode="signed" qrCodeId="q1" layoutId="l1" entitled {...(p as object)} />
    </NextIntlClientProvider>,
  );

describe("file URL and settings (HEY-37 sizes on the new surface)", () => {
  it("screen layouts offer the scales within the limits; print layouts the DPIs; SVG carries no resolution", () => {
    expect(exportFileUrl("l1", pxLayout, { format: "png", resolution: 4, transparent: false })).toBe("/api/export/l1?format=png&scale=4");
    expect(exportFileUrl("l1", mmLayout, { format: "png", resolution: 600, transparent: true })).toBe(
      "/api/export/l1?format=png&dpi=600&transparent=1",
    );
    expect(exportFileUrl("l1", mmLayout, { format: "svg", resolution: 600, transparent: false })).toBe("/api/export/l1?format=svg");
    signed();
    expect(
      screen
        .getAllByRole("button", { name: /×$/ })
        .map((b) => b.textContent)
        .sort(),
    ).toEqual(["1×", "2×", "4×"]);
    expect(screen.getByText(/3840 × 2160 px · larger sizes exceed 8192 px/)).toBeInTheDocument();
  });

  it("restores format, size and transparency from the return URL", () => {
    signed({ layout: mmLayout, initial: { format: "png", resolution: 600, transparent: true } });
    expect(screen.getByRole("button", { name: "600 dpi" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Transparent background")).toBeChecked();
    expect(screen.getAllByText("1077 × 1361 px").length).toBeGreaterThan(0);
  });

  it("reads the real file name, including a UTF-8 one", () => {
    expect(fileNameFrom(`attachment; filename="menu-kafe.png"; filename*=UTF-8''%D0%BC%D0%B5%D0%BD%D1%8E.png`, "x")).toBe("меню.png");
    expect(fileNameFrom(`attachment; filename="portfolio-card.svg"`, "x")).toBe("portfolio-card.svg");
    expect(fileNameFrom(null, "qr-code.png")).toBe("qr-code.png");
  });
});

describe("file states (design 3.7–3.10)", () => {
  it("Download prepares the file with the chosen settings, then the user's own click saves it; Download again reuses it", async () => {
    let finish: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal("fetch", fetchMock);
    signed();
    fireEvent.click(screen.getByRole("button", { name: "4×" }));
    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/export/l1?format=png&scale=4", { credentials: "same-origin" });
    expect(screen.getAllByText("Preparing your PNG…").length).toBeGreaterThan(0);
    // Settings are frozen while the file is prepared.
    expect(screen.getByRole("button", { name: "SVG" })).toBeDisabled();
    await act(async () =>
      finish(new Response(new Blob(["png"]), { headers: { "Content-Disposition": `attachment; filename="portfolio-card.png"` } })),
    );
    expect(screen.getByText("Your PNG is ready.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download PNG" });
    expect(link).toHaveAttribute("download", "portfolio-card.png");
    expect(link).toHaveAttribute("href", "blob:file");
    fireEvent.click(link);
    expect(screen.getByText(/Downloaded portfolio-card.png/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download again" })).toHaveAttribute("href", "blob:file");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A different setting is a different file: back to Download.
    fireEvent.click(screen.getByRole("button", { name: "2×" }));
    expect(screen.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  });

  it("an export error keeps every setting and Try again repeats the same request; payment is never asked again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(new Blob(["svg"]), { headers: { "Content-Disposition": `attachment; filename="card.svg"` } }));
    vi.stubGlobal("fetch", fetchMock);
    signed();
    fireEvent.click(screen.getByRole("button", { name: "SVG" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download SVG" })));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t prepare your SVG. Your payment and settings are safe.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/export/l1?format=svg", "/api/export/l1?format=svg"]);
    expect(startCheckout).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download SVG" })).toHaveAttribute("download", "card.svg");
  });

  it("back from checkout before the webhook: confirming, controls frozen, the page re-checks", () => {
    vi.useFakeTimers();
    signed({ entitled: false, checkout: "success" });
    expect(screen.getAllByText("Confirming your payment…").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Transparent background")).toBeDisabled();
    vi.advanceTimersByTime(2600);
    expect(refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("not bought yet: Pay goes to Stripe Checkout with the chosen settings; cancelled says nothing was charged", async () => {
    startCheckout.mockResolvedValue({ ok: false, error: "failed" });
    signed({ entitled: false, checkout: "cancelled" });
    expect(screen.getByText(/You weren’t charged/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pay $4.99 and download" })));
    expect(startCheckout).toHaveBeenCalledWith({
      qrCodeId: "q1",
      layoutId: "l1",
      format: "png",
      locale: "en",
      resolution: 2,
      transparent: false,
    });
  });
});

describe("guest export (design 3.1)", () => {
  it("shows the total and Continue with Google, carrying the settings through sign-in", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ExportSurface
          {...base}
          layout={pxLayout}
          mode="guest"
          signInHref={(s) => `/sign-in?next=${encodeURIComponent(`/create?resume=1&format=${s.format}&res=${s.resolution}`)}`}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "4×" }));
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/create?resume=1&format=png&res=4")}`,
    );
    expect(screen.getAllByText("$4.99").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });
});
