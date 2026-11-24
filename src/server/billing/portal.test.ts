import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://heyqr.test" } }));
vi.mock("./catalog", () => ({
  stripePriceFor: (currency: string, offer: string) => (offer === "studio" ? `price_${currency.toLowerCase()}_studio` : null),
}));
const sessions = vi.fn(async (p: unknown) => ({ url: "https://billing.stripe.test/session", params: p }));
const configs = vi.fn();
const subscriptions = vi.fn();
const customers = vi.fn();
vi.mock("./stripe", () => ({
  stripe: () => ({
    billingPortal: { sessions: { create: sessions }, configurations: { list: configs } },
    subscriptions: { retrieve: subscriptions },
    customers: { retrieve: customers },
  }),
}));
const { createPortalSession, paymentSummary, portalFeatures, portalReturnUrl } = await import("./portal");
beforeEach(() => {
  for (const f of [sessions, configs, subscriptions, customers]) f.mockClear();
});
const config = (over: { update?: boolean; prices?: string[]; payment?: boolean } = {}) => ({
  data: [
    {
      features: {
        payment_method_update: { enabled: over.payment ?? true },
        subscription_cancel: { enabled: true },
        subscription_update: { enabled: over.update ?? false, products: over.prices ? [{ prices: over.prices }] : [] },
      },
    },
  ],
});

/* HEY-139: the Customer Portal from Plan & billing. */
describe("Stripe Customer Portal (HEY-139)", () => {
  it("returns to Plan & billing in a supported locale only", () => {
    expect(portalReturnUrl("ru")).toBe("https://heyqr.test/ru/dashboard/billing");
    expect(portalReturnUrl("../evil")).toBe("https://heyqr.test/en/dashboard/billing");
  });

  it("manage opens the Portal home; payment and upgrade deep-link, upgrade in the subscription's currency", async () => {
    await createPortalSession("cus_1", "en");
    expect(sessions).toHaveBeenLastCalledWith({ customer: "cus_1", return_url: "https://heyqr.test/en/dashboard/billing" });
    await createPortalSession("cus_1", "en", "payment", "sub_1");
    expect(sessions.mock.lastCall?.[0]).toMatchObject({ flow_data: { type: "payment_method_update" } });
    subscriptions.mockResolvedValueOnce({ currency: "pln", items: { data: [{ id: "si_1" }] } });
    await createPortalSession("cus_1", "pl", "upgrade", "sub_1");
    expect(sessions.mock.lastCall?.[0]).toMatchObject({
      customer: "cus_1",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription: "sub_1", items: [{ id: "si_1", price: "price_pln_studio", quantity: 1 }] },
      },
    });
  });

  it("offers Upgrade only when the Portal can update to a catalog Studio Price", async () => {
    configs.mockResolvedValueOnce(config());
    expect(await portalFeatures()).toEqual({ paymentMethodUpdate: true, cancel: true, upgrade: false });
  });

  it("masks the payment method: the subscription's own, else the Customer's default; none when Stripe fails", async () => {
    subscriptions.mockResolvedValueOnce({ default_payment_method: { type: "card", card: { brand: "visa", last4: "4242" } } });
    expect(await paymentSummary("cus_1", "sub_1")).toEqual({ kind: "card", brand: "visa", last4: "4242" });
    subscriptions.mockResolvedValueOnce({ default_payment_method: null });
    customers.mockResolvedValueOnce({
      invoice_settings: { default_payment_method: { type: "card", card: { brand: "mastercard", last4: "4444" } } },
    });
    expect(await paymentSummary("cus_1", "sub_1")).toEqual({ kind: "card", brand: "mastercard", last4: "4444" });
    subscriptions.mockRejectedValueOnce(new Error("stripe down"));
    expect(await paymentSummary("cus_1", "sub_1")).toBeNull();
  });
});
