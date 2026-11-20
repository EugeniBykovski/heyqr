import { z } from "zod";
import { env } from "@/env";
import { CURRENCIES, isCurrency, OFFERS, type Currency, type Offer } from "./catalog-core";

export * from "./catalog-core";

/*
 * Design 4.8 / 7.1 offers and the currencies they are shown and charged in (product override: USD / EUR / PLN).
 * Display price points only; the server charges the Stripe Price configured for the same currency and offer, and
 * refuses a checkout when that price differs from the point shown (src/server/billing/catalog.ts). A currency
 * without a price point for an offer shows that offer as unavailable, never a converted or another currency's price.
 */
const pointsSchema = z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()));

/**
 * Launch price points of the design (in minor units), per currency. USD follows the existing NEXT_PUBLIC_PRICE_*
 * settings; PLN is the design's table; EUR has no price points until NEXT_PUBLIC_PRICE_POINTS sets them.
 */
function readPoints(): Record<Currency, Partial<Record<Offer, number>>> {
  const base: Record<Currency, Partial<Record<Offer, number>>> = {
    USD: {
      single: env.NEXT_PUBLIC_PRICE_STATIC_CENTS ?? 499,
      pack3: 1199,
      pack10: 2499,
      starter: env.NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS ?? 900,
      studio: 2400,
      printPack: env.NEXT_PUBLIC_PRICE_PRINT_PACK_CENTS ?? 299,
    },
    EUR: {},
    PLN: { single: 1999, pack3: 4799, pack10: 9999, starter: 3500, studio: 9500, printPack: 1199 },
  };
  const raw = env.NEXT_PUBLIC_PRICE_POINTS;
  if (!raw) return base;
  try {
    const parsed = pointsSchema.parse(JSON.parse(raw));
    for (const c of CURRENCIES) {
      const row = parsed[c];
      if (!row) continue;
      for (const o of OFFERS) if (row[o] !== undefined) base[c][o] = row[o];
    }
  } catch {
    // An unreadable setting keeps the defaults; the server's price check still guards every charge.
  }
  return base;
}

export const PRICE_POINTS = readPoints();

/** The display price of an offer in a currency (minor units), or null when that currency has no price for it. */
export const pricePoint = (currency: Currency, offer: Offer): number | null => PRICE_POINTS[currency][offer] ?? null;

/** Every offer's price in one currency (null: not offered in that currency). */
export function priceSheet(currency: Currency): Record<Offer, number | null> {
  return Object.fromEntries(OFFERS.map((o) => [o, pricePoint(currency, o)])) as Record<Offer, number | null>;
}

export const DEFAULT_CURRENCY: Currency = isCurrency(env.NEXT_PUBLIC_PRICE_CURRENCY) ? env.NEXT_PUBLIC_PRICE_CURRENCY : "USD";
