import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* HEY-97: the receipt goes out after the purchase committed; an email failure never fails or undoes it. */
vi.mock("server-only", () => ({}));
const processCheckoutEvent = vi.fn();
vi.mock("./fulfillment", () => ({ processCheckoutEvent: (...a: unknown[]) => processCheckoutEvent(...a) }));
const sendPurchaseReceipt = vi.fn();
vi.mock("../email/send", () => ({ sendPurchaseReceipt: (...a: unknown[]) => sendPurchaseReceipt(...a) }));
vi.mock("../db", () => ({
  db: { query: { user: { findFirst: async () => ({ email: "ana@example.test", name: "Ana" }) } } },
  schema: { user: { id: "id" }, webhookEvent: {}, subscription: {} },
}));
vi.mock("./catalog", () => ({ planForPrice: () => null }));
vi.mock("./allowances", () => ({ dynamicLimit: () => 0 }));

const { handleStripeEvent } = await import("./webhook");
const completed = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_1" } } } as unknown as Stripe.Event;
const receipt = { userId: "u1", qrCodeId: "q1", amountTotal: 499, currency: "usd" };

beforeEach(() => {
  processCheckoutEvent.mockReset();
  sendPurchaseReceipt.mockReset();
});

describe("checkout webhook receipt (HEY-97)", () => {
  it("a granted purchase: processed in one call, then the receipt", async () => {
    processCheckoutEvent.mockResolvedValue({ duplicate: false, result: { granted: true, receipt } });
    expect(await handleStripeEvent(completed)).toBe(true);
    expect(processCheckoutEvent).toHaveBeenCalledTimes(1);
    expect(sendPurchaseReceipt).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@example.test", qrCodeId: "q1", amountTotal: 499 }));
  });

  it("an email failure after commit is logged; the webhook still succeeds (Stripe doesn't retry a done purchase)", async () => {
    processCheckoutEvent.mockResolvedValue({ duplicate: false, result: { granted: true, receipt } });
    sendPurchaseReceipt.mockRejectedValue(Object.assign(new Error("smtp down: ana@example.test"), { name: "SmtpError" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await handleStripeEvent(completed)).toBe(true);
    expect(error).toHaveBeenCalledWith("[billing] receipt email failed: SmtpError qr=q1");
    error.mockRestore();
  });

  it("no receipt for a duplicate or a refused event; a failed transaction fails the webhook so Stripe retries", async () => {
    processCheckoutEvent.mockResolvedValueOnce({ duplicate: true });
    expect(await handleStripeEvent(completed)).toBe(false);
    processCheckoutEvent.mockResolvedValueOnce({ duplicate: false, result: { granted: false, reason: "total_mismatch" } });
    expect(await handleStripeEvent(completed)).toBe(true);
    expect(sendPurchaseReceipt).not.toHaveBeenCalled();
    processCheckoutEvent.mockRejectedValueOnce(new Error("connection reset"));
    await expect(handleStripeEvent(completed)).rejects.toThrow();
    expect(sendPurchaseReceipt).not.toHaveBeenCalled();
  });
});
