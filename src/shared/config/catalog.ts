import { OFFERS, type Currency, type Offer } from "./catalog-core";

export * from "./catalog-core";

/*
 * Design 4.8 / 7.1 offers and the currencies they are shown and charged in (USD / PLN). One authoritative table: every
 * page shows these amounts and checkout charges only a Stripe Price whose currency, amount and interval equal them
 * (src/server/billing/catalog.ts). USD and PLN are separate price points from the design, never converted. An offer
 * without a Stripe Price in a currency is shown as unavailable there.
 */

/**
 * Handoff "Design assumptions to confirm" · launch price points (Commerce 3.0 §6 and Main PRICE_TABLE), in minor units:
 * Single QR, Static Pack 3 / 10, Starter / month, Studio / month, Print Pack per QR.
 */
export const PRICE_POINTS: Record<Currency, Record<Offer, number>> = {
  USD: { single: 499, pack3: 1199, pack10: 2499, starter: 900, studio: 2400, printPack: 299 },
  PLN: { single: 1999, pack3: 4799, pack10: 9999, starter: 3500, studio: 9500, printPack: 1199 },
};

/** The display price of an offer in a currency (minor units), or null when that currency has no price for it. */
export const pricePoint = (currency: Currency, offer: Offer): number | null => PRICE_POINTS[currency][offer] ?? null;

/** Every offer's price in one currency (null: not offered in that currency). */
export function priceSheet(currency: Currency): Record<Offer, number | null> {
  return Object.fromEntries(OFFERS.map((o) => [o, pricePoint(currency, o)])) as Record<Offer, number | null>;
}

/** The product's default currency, also for a saved preference that is no longer offered (e.g. EUR, GBP). */
export const DEFAULT_CURRENCY: Currency = "USD";
