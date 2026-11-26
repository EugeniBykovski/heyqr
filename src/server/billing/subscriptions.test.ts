import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { cancellationClearParams, clearStripeCancellation } from "./subscriptions";

/*
 * HEY-185 "Keep my plan": Stripe rejects an update naming both cancel_at and cancel_at_period_end, and the Customer
 * Portal schedules with cancel_at. Found against Stripe test mode, where every resume failed with "Received both
 * cancel_at_period_end and cancel_at parameters. Please pass in only one."
 */
describe("clearing a scheduled cancellation (HEY-185)", () => {
  it("clears the field Stripe actually set, never both", () => {
    // The Portal's way: a cutoff date, cancel_at_period_end false.
    expect(cancellationClearParams({ cancel_at: 1_798_296_682, cancel_at_period_end: false })).toEqual({ cancel_at: "" });
    // The API's other way: cancel at period end (Stripe also fills cancel_at with that date).
    expect(cancellationClearParams({ cancel_at: 1_798_296_682, cancel_at_period_end: true })).toEqual({ cancel_at_period_end: false });
    for (const current of [
      { cancel_at: 1, cancel_at_period_end: false },
      { cancel_at: 1, cancel_at_period_end: true },
      { cancel_at: null, cancel_at_period_end: true },
      { cancel_at: null, cancel_at_period_end: false },
    ])
      expect(Object.keys(cancellationClearParams(current))).toHaveLength(1);
  });

  it("reads the subscription first and sends Stripe a single cancellation field", async () => {
    const retrieve = vi.fn(async () => ({ id: "sub_1", cancel_at: 1_798_296_682, cancel_at_period_end: false }));
    const update = vi.fn(async (_id: string, params: Record<string, unknown>) => {
      if ("cancel_at" in params && "cancel_at_period_end" in params) throw new Error("Please pass in only one.");
      return { id: "sub_1", cancel_at: null, cancel_at_period_end: false };
    });
    const stripe = { subscriptions: { retrieve, update } } as unknown as Pick<Stripe, "subscriptions">;
    await expect(clearStripeCancellation(stripe, "sub_1")).resolves.toMatchObject({ cancel_at: null });
    expect(update).toHaveBeenCalledWith("sub_1", { cancel_at: "" });
  });
});
