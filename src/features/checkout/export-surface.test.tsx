// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, presetSize } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { ExportSurface, exportFileUrl, fileNameFrom, type ExportOffer, type ExportSurfaceProps } from "./export-surface";

const startCheckout = vi.fn();
vi.mock("@/server/actions/qr", () => ({ startCheckout: (...a: unknown[]) => startCheckout(...a) }));
vi.mock("@/server/actions/billing", () => ({
  unlockWithAllowance: vi.fn(),
  takeIncludedPrintPack: vi.fn(),
  activateDynamic: vi.fn(),
  makeStatic: vi.fn(),
}));
const refresh = vi.fn();
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh, push }),
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));
afterEach(cleanup);
beforeEach(() => {
  startCheckout.mockReset();
  refresh.mockReset();
  push.mockReset();
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
  price: { cents: 499, currency: "USD" as const },
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
    // HEY-102: prepare checks access and stores the file; no bytes come to the page.
    expect(fetchMock).toHaveBeenCalledWith("/api/export/l1?qr=q1&format=png&scale=4&prepare=1", { credentials: "same-origin" });
    expect(screen.getAllByText("Preparing your PNG…").length).toBeGreaterThan(0);
    // Settings are frozen while the file is prepared.
    expect(screen.getByRole("button", { name: "SVG" })).toBeDisabled();
    await act(async () => finish(Response.json({ ready: true, name: "portfolio-card.png" })));
    expect(screen.getByText("Your PNG is ready.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download PNG" });
    expect(link).toHaveAttribute("download", "portfolio-card.png");
    // The click goes to the file route, which rechecks access and redirects to a fresh short-lived signed link.
    expect(link).toHaveAttribute("href", "/api/export/l1?qr=q1&format=png&scale=4");
    fireEvent.click(link);
    expect(screen.getByText(/Downloaded portfolio-card.png/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download again" })).toHaveAttribute("href", "/api/export/l1?qr=q1&format=png&scale=4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A different setting is a different file: back to Download.
    fireEvent.click(screen.getByRole("button", { name: "2×" }));
    expect(screen.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  });

  it("an export error keeps every setting and Try again repeats the same request; payment is never asked again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
      .mockResolvedValueOnce(Response.json({ ready: true, name: "card.svg" }));
    vi.stubGlobal("fetch", fetchMock);
    signed();
    fireEvent.click(screen.getByRole("button", { name: "SVG" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download SVG" })));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t prepare your SVG. Your payment and settings are safe.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/export/l1?qr=q1&format=svg&prepare=1",
      "/api/export/l1?qr=q1&format=svg&prepare=1",
    ]);
    expect(startCheckout).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download SVG" })).toHaveAttribute("download", "card.svg");
  });

  it("a session that ended: says so, keeps the settings in the address and signs in again back to this screen (HEY-78)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })));
    signed();
    fireEvent.click(screen.getByRole("button", { name: "SVG" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download SVG" })));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session ended. Sign in again to continue: this layout and your file options are kept.",
    );
    expect(window.location.search).toContain("format=svg");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(push).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
  });

  it("checkout refused because the session ended shows the same sign-in path, not a payment error (HEY-78)", async () => {
    startCheckout.mockResolvedValue({ ok: false, error: "unauthorized" });
    signed({ entitled: false });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Pay/ })));
    expect(screen.getByRole("alert")).toHaveTextContent("Your session ended.");
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

  it("confirming a payment: navigation stays available, Pay stays hidden and the settings stay locked (HEY-92)", () => {
    vi.useFakeTimers();
    const layouts = [
      { id: "l1", name: "Business card", href: "/create/export?qr=q1&layout=l1&format=png", active: true },
      { id: "l2", name: "Poster", href: "/create/export?qr=q1&layout=l2&format=png", active: false },
    ];
    signed({ entitled: false, checkout: "success", layouts, initial: { format: "png", resolution: 600, transparent: true } });
    // Leaving is allowed: coming back is confirmed by the server (the paid order), not by these links.
    expect(screen.getByRole("link", { name: "Poster" })).toHaveAttribute("href", layouts[1]?.href);
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeNull();
    expect(screen.getAllByText("Confirming your payment…").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Transparent background")).toBeDisabled();
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
      printPack: false,
    });
  });
});

describe("the note under the main action (HEY-180, design 3.11)", () => {
  const STRIPE = "You’ll finish on Stripe’s secure checkout, then come back here to download.";
  const INCLUDED = "Included in your purchase. Nothing to pay.";
  const offer = (path: ExportOffer["path"]): ExportOffer => ({
    path,
    cents: { single: 499, pack3: 1199, studio: 2400 },
    credits: 2,
    planName: "Starter",
    unlocks: { left: 9, limit: 10 },
    printPack: null,
  });

  it("paid for: Download again says nothing is left to pay, never that checkout comes next", () => {
    signed({ entitled: true });
    expect(screen.getByText(INCLUDED)).toBeInTheDocument();
    expect(screen.queryByText(STRIPE)).toBeNull();
  });

  it("the next step is Stripe (Single QR, or no server offer): the Stripe note", () => {
    signed({ entitled: false, offer: offer("buy") });
    expect(screen.getByText(STRIPE)).toBeInTheDocument();
    cleanup();
    signed({ entitled: false });
    expect(screen.getByText(STRIPE)).toBeInTheDocument();
  });

  it("covered by a credit or the plan: no Stripe note and no claim of a purchase", () => {
    for (const path of ["credit", "unlock"] as const) {
      signed({ entitled: false, offer: offer(path) });
      expect(screen.queryByText(STRIPE), path).toBeNull();
      expect(screen.queryByText(INCLUDED), path).toBeNull();
      cleanup();
    }
  });
});

describe("guest export (design 3.1)", () => {
  it("shows the total and one sign-in action, built for the current settings", () => {
    const signInAction = vi.fn((s: { format: string; resolution: number; transparent: boolean }) => (
      <button type="button">{`Continue with Google ${s.format} ${s.resolution} ${s.transparent ? "clear" : "solid"}`}</button>
    ));
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ExportSurface {...base} layout={pxLayout} mode="guest" signInAction={signInAction} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "4×" }));
    expect(screen.getByRole("button", { name: "Continue with Google png 4 solid" })).toBeTruthy();
    expect(screen.getAllByText("$4.99").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("back from a canceled Google sign-in: a notice, the same settings and the same button to retry (HEY-76)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ExportSurface
          {...base}
          layout={pxLayout}
          mode="guest"
          initial={{ format: "png", resolution: 4, transparent: true }}
          signInNotice="canceled"
          signInAction={(s) => <button type="button">{`Continue with Google ${s.format} ${s.resolution} ${String(s.transparent)}`}</button>}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen
        .getAllByRole("status")
        .map((e) => e.textContent)
        .join(" "),
    ).toMatch(/Google sign-in was canceled\. Your layout and PNG are still selected/);
    expect(screen.getByRole("button", { name: "Continue with Google png 4 true" })).toBeTruthy();
  });
});

/* HEY-118: before activation a Dynamic code's art is the preview short link, marked as a preview. */
describe("Dynamic short link preview (HEY-118)", () => {
  it("marks the art as a preview and says the files carry the permanent short link", () => {
    signed({ model: "dynamic", entitled: false, shortLinkPreview: true, value: "http://localhost:3000/r/preview" });
    expect(screen.getByText(/Preview with a sample short link/)).toBeTruthy();
    expect(document.querySelector('[data-slot="stage-canvas"]')?.textContent).toContain("Preview");
  });

  it("an activated Dynamic code and a Static code show no preview mark", () => {
    signed({ model: "dynamic", value: "http://localhost:3000/r/NpuL2yb" });
    expect(screen.queryByText(/Preview with a sample short link/)).toBeNull();
    cleanup();
    signed();
    expect(document.querySelector('[data-slot="short-link-preview"]')).toBeNull();
  });
});
