import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    STRIPE_PRICE_STATIC: "price_usd_single",
    STRIPE_PRICE_DYNAMIC_MONTHLY: "price_usd_starter",
    STRIPE_PRICE_PRINT_PACK: undefined,
    // EUR is no longer sold (HEY-60): a leftover entry is ignored.
    STRIPE_PRICES: JSON.stringify({
      PLN: { single: "price_pln_single", studio: "price_pln_studio", pack3: "not-a-price" },
      EUR: { single: "price_eur_single" },
    }),
  },
}));
const { missingSettings, planForPrice, priceMatches, purchasable, stripePriceFor, stripePriceMap } = await import("./catalog");
const { CURRENCIES, DEFAULT_CURRENCY, isCurrency, priceSheet, pricePoint } = await import("@/shared/config/catalog");

/* Design 4.8 / 7.1 catalog: an offer is charged only with its own currency's Stripe Price, at the price shown. */
describe("catalog", () => {
  it("fills USD from the legacy settings and reads other currencies from STRIPE_PRICES; malformed entries are skipped", () => {
    expect(stripePriceFor("USD", "single")).toBe("price_usd_single");
    expect(stripePriceFor("USD", "starter")).toBe("price_usd_starter");
    expect(stripePriceFor("PLN", "single")).toBe("price_pln_single");
    expect(stripePriceFor("PLN", "starter")).toBeNull();
    // A malformed entry is skipped on its own; unreadable JSON adds nothing.
    expect(stripePriceFor("PLN", "pack3")).toBeNull();
    expect(stripePriceMap('{"PLN":{"pack3":"nope","pack10":"price_pln_10"}}').PLN).toEqual({ pack10: "price_pln_10" });
    expect(stripePriceMap("{oops").PLN).toEqual({});
    expect(Object.keys(stripePriceMap())).toEqual(["USD", "PLN"]);
    expect(planForPrice("price_pln_studio")).toBe("studio");
    expect(planForPrice("price_usd_starter")).toBe("starter");
  });

  it("HEY-60: exactly USD and PLN, at the design's separately defined price points; an old EUR / GBP choice falls back to USD", () => {
    expect(CURRENCIES).toEqual(["USD", "PLN"]);
    // Handoff Commerce 3.0 §6 and Main PRICE_TABLE.
    expect(priceSheet("USD")).toEqual({ single: 499, pack3: 1199, pack10: 2499, starter: 900, studio: 2400, printPack: 299 });
    expect(priceSheet("PLN")).toEqual({ single: 1999, pack3: 4799, pack10: 9999, starter: 3500, studio: 9500, printPack: 1199 });
    expect(pricePoint("PLN", "pack10")).toBe(9999);
    for (const old of ["EUR", "GBP", "usd", ""]) expect(isCurrency(old)).toBe(false);
    expect(DEFAULT_CURRENCY).toBe("USD");
    expect(purchasable("PLN", "single")).toBe(true);
    expect(purchasable("PLN", "starter")).toBe(false);
    const missing = missingSettings();
    expect(missing.every((m) => m.currency === "USD" || m.currency === "PLN")).toBe(true);
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
