import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* HEY-97: the receipt goes out after the purchase committed; an email failure never fails or undoes it. */
vi.mock("server-only", () => ({}));
const processCheckoutEvent = vi.fn();
vi.mock("./fulfillment", () => ({ processCheckoutEvent: (...a: unknown[]) => processCheckoutEvent(...a) }));
const sendPurchaseReceipt = vi.fn();
vi.mock("../email/send", () => ({ sendPurchaseReceipt: (...a: unknown[]) => sendPurchaseReceipt(...a) }));
const claimed = vi.fn(async () => [{ id: "evt" }]);
vi.mock("../db", () => ({
  db: {
    query: { user: { findFirst: async () => ({ email: "ana@example.test", name: "Ana" }) } },
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: claimed }) }) }),
  },
  schema: { user: { id: "id" }, webhookEvent: {}, subscription: {} },
}));
vi.mock("./catalog", () => ({ planForPrice: () => null }));
vi.mock("./stripe", () => ({ stripe: () => ({}) }));
const processRefundEvent = vi.fn();
vi.mock("./refunds", () => ({ processRefundEvent: (...a: unknown[]) => processRefundEvent(...a) }));
const applySubscriptionEvent = vi.fn();
vi.mock("./subscriptions", () => ({ applySubscriptionEvent: (...a: unknown[]) => applySubscriptionEvent(...a) }));

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

  it("refund events go to the refund path once; a duplicate reports as such (HEY-100)", async () => {
    const refund = {
      id: "evt_r1",
      type: "refund.updated",
      data: {
        object: {
          id: "re_1",
          status: "succeeded",
          amount: 299,
          currency: "usd",
          payment_intent: "pi_1",
          metadata: { heyqr_lines: "printPack" },
        },
      },
    } as unknown as Stripe.Event;
    processRefundEvent.mockResolvedValueOnce({ duplicate: false, outcome: "applied", lines: ["printPack"], creditsRemoved: 0 });
    expect(await handleStripeEvent(refund)).toBe(true);
    expect(processRefundEvent.mock.calls[0]?.[1]).toEqual({
      id: "evt_r1",
      type: "refund.updated",
      refund: {
        id: "re_1",
        status: "succeeded",
        amount: 299,
        currency: "usd",
        payment_intent: "pi_1",
        metadata: { heyqr_lines: "printPack" },
      },
    });
    processRefundEvent.mockResolvedValueOnce({ duplicate: true });
    expect(await handleStripeEvent(refund)).toBe(false);
    expect(processCheckoutEvent).not.toHaveBeenCalled();
  });
});

/* HEY-132: every subscription lifecycle event goes through the Customer-bound path, once per event. */
describe("subscription lifecycle webhooks (HEY-132)", () => {
  it("created, updated and deleted are applied by applySubscriptionEvent with the subscription; a duplicate is skipped", async () => {
    applySubscriptionEvent.mockResolvedValue({ applied: true, userId: "u1" });
    for (const type of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      const sub = { id: "sub_1", customer: "cus_1", metadata: { userId: "u1" } };
      expect(await handleStripeEvent({ id: `evt_${type}`, type, data: { object: sub } } as unknown as Stripe.Event)).toBe(true);
      expect(applySubscriptionEvent).toHaveBeenLastCalledWith(expect.anything(), sub, expect.any(Function));
    }
    claimed.mockResolvedValueOnce([]);
    expect(
      await handleStripeEvent({
        id: "evt_dup",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_1" } },
      } as unknown as Stripe.Event),
    ).toBe(false);
    expect(applySubscriptionEvent).toHaveBeenCalledTimes(3);
  });
});
