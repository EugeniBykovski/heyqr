import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    STRIPE_PRICE_STATIC: "price_usd_single",
    STRIPE_PRICE_DYNAMIC_MONTHLY: "price_usd_starter",
    STRIPE_PRICE_PRINT_PACK: undefined,
    STRIPE_PRICES: JSON.stringify({ PLN: { single: "price_pln_single", studio: "price_pln_studio" }, EUR: { pack3: "not-a-price" } }),
    NEXT_PUBLIC_PRICE_STATIC_CENTS: 499,
    NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS: 900,
    NEXT_PUBLIC_PRICE_PRINT_PACK_CENTS: 299,
    NEXT_PUBLIC_PRICE_POINTS: undefined,
    NEXT_PUBLIC_PRICE_CURRENCY: "USD",
  },
}));
const { missingSettings, planForPrice, priceMatches, purchasable, stripePriceFor, stripePriceMap } = await import("./catalog");
const { priceSheet, pricePoint } = await import("@/shared/config/catalog");

/* Design 4.8 / 7.1 catalog: an offer is charged only with its own currency's Stripe Price, at the price shown. */
describe("catalog", () => {
  it("fills USD from the legacy settings and reads other currencies from STRIPE_PRICES; malformed entries are skipped", () => {
    expect(stripePriceFor("USD", "single")).toBe("price_usd_single");
    expect(stripePriceFor("USD", "starter")).toBe("price_usd_starter");
    expect(stripePriceFor("PLN", "single")).toBe("price_pln_single");
    expect(stripePriceFor("PLN", "starter")).toBeNull();
    // A malformed entry is skipped on its own; unreadable JSON adds nothing.
    expect(stripePriceMap('{"EUR":{"pack3":"nope","pack10":"price_eur_10"}}').EUR).toEqual({ pack10: "price_eur_10" });
    expect(stripePriceMap("{oops").EUR).toEqual({});
    expect(planForPrice("price_pln_studio")).toBe("studio");
    expect(planForPrice("price_usd_starter")).toBe("starter");
  });

  it("EUR has no price points until configured: nothing is converted or borrowed from USD", () => {
    expect(priceSheet("EUR")).toEqual({ single: null, pack3: null, pack10: null, starter: null, studio: null, printPack: null });
    expect(pricePoint("PLN", "pack10")).toBe(9999);
    expect(purchasable("EUR", "single")).toBe(false);
    expect(purchasable("PLN", "single")).toBe(true);
    const missing = missingSettings();
    expect(missing.filter((m) => m.currency === "EUR")).toHaveLength(6);
    expect(missing).toContainEqual({ currency: "USD", offer: "printPack", missing: ["Stripe Price"] });
  });

  it("a Stripe Price must match the shown price's currency, amount and interval", () => {
    const one = { currency: "usd", unit_amount: 499, recurring: null, active: true };
    expect(priceMatches(one, "USD", "single")).toBe(true);
    expect(priceMatches({ ...one, unit_amount: 599 }, "USD", "single")).toBe(false);
    expect(priceMatches({ ...one, currency: "eur" }, "USD", "single")).toBe(false);
    expect(priceMatches({ ...one, active: false }, "USD", "single")).toBe(false);
    expect(priceMatches({ currency: "usd", unit_amount: 900, recurring: { interval: "month" }, active: true }, "USD", "starter")).toBe(
      true,
    );
    expect(priceMatches({ currency: "usd", unit_amount: 900, recurring: null, active: true }, "USD", "starter")).toBe(false);
  });
});
