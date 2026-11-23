import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * HEY-95: the webhook route trusts only events signed by Stripe over the exact request body. Verification is the real
 * Stripe SDK (webhooks.constructEvent, no network) with a test-only signing secret; the event handler is stubbed so a
 * rejected request can be shown to process nothing.
 */
const SECRET = "whsec_test_only_hey95_not_a_real_secret";
const sdk = new Stripe("sk_test_unused_hey95");
const handleStripeEvent = vi.fn<(event: Stripe.Event) => Promise<boolean>>(async () => true);

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ isConfigured: () => true, paymentsConfig: () => ({ STRIPE_WEBHOOK_SECRET: SECRET }) }));
vi.mock("@/server/billing/stripe", () => ({ stripe: () => sdk }));
vi.mock("@/server/billing/webhook", () => ({ handleStripeEvent: (e: Stripe.Event) => handleStripeEvent(e) }));

const { POST } = await import("./route");

const payload = JSON.stringify({
  id: "evt_test_hey95",
  object: "event",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_hey95", object: "checkout.session", payment_status: "paid", metadata: { orderId: "o1" } } },
});
const sign = (body: string, secret = SECRET) => sdk.webhooks.generateTestHeaderString({ payload: body, secret });
const post = (body: string, signature?: string) =>
  POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...(signature ? { "stripe-signature": signature } : {}) },
    }),
  );

beforeEach(() => handleStripeEvent.mockClear());

describe("Stripe webhook signature (HEY-95)", () => {
  it("a valid signature over the exact body reaches the handler and returns 200", async () => {
    const res = await post(payload, sign(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });
    expect(handleStripeEvent).toHaveBeenCalledTimes(1);
    expect(handleStripeEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "evt_test_hey95", type: "checkout.session.completed" }));
  });

  it("a missing signature: 400 missing_signature, nothing processed", async () => {
    const res = await post(payload);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_signature" });
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("a signature that fails verification: 400 invalid_signature, nothing processed", async () => {
    for (const signature of [sign(payload, "whsec_some_other_secret"), "t=1,v1=deadbeef", "not-a-signature"]) {
      const res = await post(payload, signature);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_signature" });
    }
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("a body changed after signing: 400 invalid_signature, nothing processed", async () => {
    const signature = sign(payload);
    const tampered = payload.replace('"payment_status":"paid"', '"payment_status":"paid","metadata":{"orderId":"another"}');
    for (const body of [tampered, payload.replace("cs_test_hey95", "cs_test_other"), `${payload} `, payload.replace(/,/, ", ")]) {
      expect(body).not.toBe(payload);
      const res = await post(body, signature);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_signature" });
    }
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("a signature older than Stripe's tolerance: 400 invalid_signature, nothing processed", async () => {
    const old = sdk.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 60 * 60 });
    const res = await post(payload, old);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });
});
