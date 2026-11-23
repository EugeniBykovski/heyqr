import { describe, expect, it } from "vitest";
import type { PaidSession } from "./fulfillment";
import { verifyCheckoutPayment } from "./fulfillment";

/* HEY-96: a one-time Checkout pays its stored order only when Stripe's amounts follow from the order's own lines. */
type Order = Parameters<typeof verifyCheckoutPayment>[0];
const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  userId: "u1",
  qrCodeId: "q1",
  item: "single_qr_print_pack",
  lines: [
    { offer: "single", amount: 499 },
    { offer: "printPack", amount: 299 },
  ],
  stripeCheckoutSessionId: "cs_test_1",
  stripePaymentIntentId: null,
  amountTotal: 798,
  currency: "usd",
  status: "pending",
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});
const session = (over: Partial<PaidSession> = {}, totals: Partial<NonNullable<PaidSession["total_details"]>> = {}): PaidSession => ({
  id: "cs_test_1",
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  payment_intent: "pi_1",
  amount_subtotal: 798,
  amount_total: 798,
  currency: "usd",
  metadata: { userId: "u1", qrCodeId: "q1", orderId: "o1" },
  total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0, ...totals },
  ...over,
});
const verdict = (o: Order, s: PaidSession) => verifyCheckoutPayment(o, s);

describe("one-time Checkout payment verification (HEY-96)", () => {
  it("the exact order total, no tax or discount: paid as charged", () => {
    expect(verdict(order(), session())).toEqual({ ok: true, paid: 798 });
  });

  it("automatic tax on top (exclusive) or inside the price (inclusive): the paid total includes it", () => {
    expect(verdict(order(), session({ amount_total: 862 }, { amount_tax: 64 }))).toEqual({ ok: true, paid: 862 });
    expect(verdict(order(), session({ amount_total: 798 }, { amount_tax: 149 }))).toEqual({ ok: true, paid: 798 });
  });

  it("a promotion code: the discount comes off the subtotal, with or without tax", () => {
    expect(verdict(order(), session({ amount_total: 698 }, { amount_discount: 100 }))).toEqual({ ok: true, paid: 698 });
    expect(verdict(order(), session({ amount_total: 754 }, { amount_discount: 100, amount_tax: 56 }))).toEqual({ ok: true, paid: 754 });
    // A 100 % code: nothing to pay, still the order's items.
    expect(verdict(order(), session({ amount_total: 0 }, { amount_discount: 798 }))).toEqual({ ok: true, paid: 0 });
  });

  it("a wrong amount: the items Stripe charged differ from the order, or the total doesn't follow from them", () => {
    expect(verdict(order(), session({ amount_subtotal: 499, amount_total: 499 }))).toEqual({ ok: false, reason: "subtotal_mismatch" });
    expect(verdict(order(), session({ amount_total: 1 }))).toEqual({ ok: false, reason: "total_mismatch" });
    expect(verdict(order(), session({ amount_total: 820 }, { amount_tax: 64 }))).toEqual({ ok: false, reason: "total_mismatch" });
    expect(verdict(order(), session({ amount_total: 0 }, { amount_discount: 900 }))).toEqual({ ok: false, reason: "total_mismatch" });
    expect(verdict(order(), session({ amount_total: 898 }, { amount_shipping: 100 }))).toEqual({ ok: false, reason: "total_mismatch" });
  });

  it("a wrong currency, even with the same number", () => {
    expect(verdict(order(), session({ currency: "pln" }))).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(verdict(order({ currency: "pln" }), session({ currency: "PLN" }))).toEqual({ ok: true, paid: 798 });
  });

  it("not paid: open, expired, or complete with the payment still processing", () => {
    expect(verdict(order(), session({ status: "open", payment_status: "unpaid" }))).toEqual({ ok: false, reason: "not_paid" });
    expect(verdict(order(), session({ status: "expired", payment_status: "unpaid" }))).toEqual({ ok: false, reason: "not_paid" });
    expect(verdict(order(), session({ status: "complete", payment_status: "unpaid" }))).toEqual({ ok: false, reason: "not_paid" });
    expect(verdict(order(), session({ status: "complete", payment_status: "no_payment_required" }))).toEqual({
      ok: false,
      reason: "not_paid",
    });
  });

  it("missing or impossible amounts are refused explicitly", () => {
    expect(verdict(order(), session({ amount_subtotal: null }))).toEqual({ ok: false, reason: "missing_amounts" });
    expect(verdict(order(), session({ amount_total: null }))).toEqual({ ok: false, reason: "missing_amounts" });
    expect(verdict(order(), session({ total_details: null }))).toEqual({ ok: false, reason: "missing_amounts" });
    expect(verdict(order(), session({ currency: null }))).toEqual({ ok: false, reason: "missing_amounts" });
    expect(verdict(order(), session({ amount_total: 798.5 }))).toEqual({ ok: false, reason: "missing_amounts" });
    expect(verdict(order(), session({}, { amount_tax: -1 }))).toEqual({ ok: false, reason: "missing_amounts" });
  });

  it("another account, order or code than the stored order's own", () => {
    expect(verdict(order(), session({ metadata: { userId: "u2", qrCodeId: "q1", orderId: "o1" } }))).toEqual({
      ok: false,
      reason: "owner_mismatch",
    });
    expect(verdict(order(), session({ metadata: { qrCodeId: "q1", orderId: "o1" } }))).toEqual({ ok: false, reason: "owner_mismatch" });
    expect(verdict(order(), session({ metadata: { userId: "u1", qrCodeId: "q1", orderId: "o2" } }))).toEqual({
      ok: false,
      reason: "order_mismatch",
    });
    expect(verdict(order(), session({ metadata: { userId: "u1", qrCodeId: "q2", orderId: "o1" } }))).toEqual({
      ok: false,
      reason: "qr_mismatch",
    });
    // An account-scoped pack never names a code.
    const pack = order({ qrCodeId: null, item: "pack3", lines: [{ offer: "pack3", amount: 1199 }], amountTotal: 1199 });
    const packSession = session({ amount_subtotal: 1199, amount_total: 1199, metadata: { userId: "u1", kind: "pack", pack: "pack3" } });
    expect(verdict(pack, packSession)).toEqual({ ok: true, paid: 1199 });
    expect(verdict(pack, { ...packSession, metadata: { userId: "u1", qrCodeId: "q1" } })).toEqual({ ok: false, reason: "qr_mismatch" });
  });

  it("an order already paid, refunded or failed is never paid again", () => {
    expect(verdict(order({ status: "paid" }), session())).toEqual({ ok: false, reason: "already_paid" });
    expect(verdict(order({ status: "refunded" }), session())).toEqual({ ok: false, reason: "order_closed" });
    expect(verdict(order({ status: "failed" }), session())).toEqual({ ok: false, reason: "order_closed" });
  });

  it("a valid legacy pending order: lines missing, its recorded item amount is the expected subtotal", () => {
    const legacy = order({ item: "single_qr", lines: null, amountTotal: 499 });
    const meta = { userId: "u1", qrCodeId: "q1" }; // no orderId on sessions made before HEY-88
    expect(verdict(legacy, session({ amount_subtotal: 499, amount_total: 499, metadata: meta }))).toEqual({ ok: true, paid: 499 });
    expect(verdict(legacy, session({ amount_subtotal: 999, amount_total: 999, metadata: meta }))).toEqual({
      ok: false,
      reason: "subtotal_mismatch",
    });
    expect(verdict(order({ lines: [], amountTotal: 798 }), session())).toEqual({ ok: true, paid: 798 });
  });
});
