import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000", NEXT_PUBLIC_SHORT_LINK_BASE: "http://localhost:3000/r" } }));
vi.mock("../auth", () => ({ requireUser: async () => ({ id: "u1", email: "u1@test", name: "U1" }) }));
vi.mock("../db", () => ({ db: {}, schema: {} }));
vi.mock("../currency", () => ({ getCurrency: async () => "USD" }));
const owned = vi.fn();
vi.mock("../qr/file-access", () => ({ ownedLayout: (...a: unknown[]) => owned(...a) }));
const createCheckout = vi.fn(async () => "https://checkout.example/s");
const createPrintPackCheckout = vi.fn(async () => "https://checkout.example/p");
vi.mock("../billing/checkout", () => ({
  createCheckout: (...a: unknown[]) => createCheckout(...(a as [])),
  createPrintPackCheckout: (...a: unknown[]) => createPrintPackCheckout(...(a as [])),
  createPortalSession: vi.fn(),
  CatalogError: class extends Error {},
}));
vi.mock("../billing/entitlements", () => ({ canDownload: async () => true, printPackForSale: () => true, activeSubscription: vi.fn() }));
vi.mock("../storage/s3", () => ({ logoStore: () => null }));
const { startCheckout, startPrintPackCheckout } = await import("./qr");

/* HEY-84: checkouts start only for the user's code and a layout of that code; a Print Pack once, for a print layout. */
const record = (unit: "mm" | "px") => {
  const d = { ...DEFAULT_DESIGN, size: unit === "mm" ? { unit: "mm" as const, qr: 40, width: 40, height: 40 } : DEFAULT_DESIGN.size };
  return { schemaVersion: 1, layout: designToLayout(d), editor: designSettingsOf(d) };
};
const qr = (printPackAt: Date | null = null) => ({ id: "q1", userId: "u1", model: "static", printPackAt, purchasedAt: new Date() });
const checkout = { qrCodeId: "q1", layoutId: "l-other", format: "png" as const, locale: "en" };

beforeEach(() => {
  owned.mockReset();
  createCheckout.mockClear();
  createPrintPackCheckout.mockClear();
});

describe("checkout authorization (HEY-84)", () => {
  it("a layout that isn't this code's (or someone else's code): not_found, nothing sent to Stripe", async () => {
    owned.mockResolvedValue(null);
    expect(await startCheckout(checkout)).toEqual({ ok: false, error: "not_found" });
    expect(await startPrintPackCheckout({ ...checkout, settings: "scale=1" })).toEqual({ ok: false, error: "not_found" });
    expect(owned).toHaveBeenCalledWith({}, "u1", "q1", "l-other");
    expect(createCheckout).not.toHaveBeenCalled();
    expect(createPrintPackCheckout).not.toHaveBeenCalled();
  });

  it("the user's code and its own layout: the checkout starts", async () => {
    owned.mockResolvedValue({ qr: qr(), layout: { id: "l1", design: record("mm") } });
    expect(await startCheckout({ ...checkout, layoutId: "l1" })).toEqual({ ok: true, data: { url: "https://checkout.example/s" } });
    expect(await startPrintPackCheckout({ ...checkout, layoutId: "l1", settings: "scale=1" })).toEqual({
      ok: true,
      data: { url: "https://checkout.example/p" },
    });
  });

  it("a Print Pack is bought once per code, and only for a print (mm) layout", async () => {
    owned.mockResolvedValue({ qr: qr(new Date()), layout: { id: "l1", design: record("mm") } });
    expect(await startPrintPackCheckout({ ...checkout, layoutId: "l1", settings: "scale=1" })).toEqual({ ok: false, error: "not_offered" });
    owned.mockResolvedValue({ qr: qr(), layout: { id: "l1", design: record("px") } });
    expect(await startPrintPackCheckout({ ...checkout, layoutId: "l1", settings: "scale=1" })).toEqual({ ok: false, error: "invalid" });
    expect(createPrintPackCheckout).not.toHaveBeenCalled();
  });
});
