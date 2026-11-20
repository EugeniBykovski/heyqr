import { z } from "zod";
import { env } from "@/env";
import { CURRENCIES, OFFERS, pricePoint, type Currency, type Offer } from "@/shared/config/catalog";

/*
 * Design 4.8 catalog on the server: which Stripe Price charges an offer in a currency, and the check that the charge
 * equals what the page showed. The client never decides an amount: checkout sends offer + currency, the server looks
 * up the Price, and refuses when the Price's currency, amount or interval differ from the configured price point.
 * Plain module (no "server-only") so tests use the same rules.
 */
const priceId = z.string().startsWith("price_");

export function stripePriceMap(raw: string | undefined = env.STRIPE_PRICES): Record<Currency, Partial<Record<Offer, string>>> {
  const map: Record<Currency, Partial<Record<Offer, string>>> = { USD: {}, EUR: {}, PLN: {} };
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  // Each entry on its own: a malformed one is skipped (that offer isn't sold), the others still apply.
  if (parsed && typeof parsed === "object")
    for (const c of CURRENCIES) {
      const row = (parsed as Record<string, unknown>)[c];
      if (!row || typeof row !== "object") continue;
      for (const o of OFFERS) {
        const id = priceId.safeParse((row as Record<string, unknown>)[o]);
        if (id.success) map[c][o] = id.data;
      }
    }
  // Legacy single-currency settings fill USD (the Dynamic plan is Starter).
  map.USD.single ??= env.STRIPE_PRICE_STATIC;
  map.USD.starter ??= env.STRIPE_PRICE_DYNAMIC_MONTHLY;
  map.USD.printPack ??= env.STRIPE_PRICE_PRINT_PACK;
  return map;
}

/** The Stripe Price for an offer in a currency, or null when it can't be bought in that currency. */
export const stripePriceFor = (currency: Currency, offer: Offer): string | null => stripePriceMap()[currency][offer] ?? null;

/** Can this offer be bought in this currency? Needs both a display price point and a Stripe Price. */
export const purchasable = (currency: Currency, offer: Offer) =>
  pricePoint(currency, offer) !== null && stripePriceFor(currency, offer) !== null;

/** What the design's catalog is still missing per currency, for the deploy notes and the docs. */
export function missingSettings(): { currency: Currency; offer: Offer; missing: ("price point" | "Stripe Price")[] }[] {
  const out: { currency: Currency; offer: Offer; missing: ("price point" | "Stripe Price")[] }[] = [];
  for (const c of CURRENCIES)
    for (const o of OFFERS) {
      const missing: ("price point" | "Stripe Price")[] = [];
      if (pricePoint(c, o) === null) missing.push("price point");
      if (stripePriceFor(c, o) === null) missing.push("Stripe Price");
      if (missing.length) out.push({ currency: c, offer: o, missing });
    }
  return out;
}

export const RECURRING: Partial<Record<Offer, "month">> = { starter: "month", studio: "month" };

/**
 * A Stripe Price as charged, against the price point shown. Mismatch → the checkout is refused, so a customer is
 * never charged an amount or currency the page didn't show.
 */
export function priceMatches(
  price: { currency: string; unit_amount: number | null; recurring: { interval: string } | null; active: boolean },
  currency: Currency,
  offer: Offer,
): boolean {
  const point = pricePoint(currency, offer);
  return (
    price.active &&
    point !== null &&
    price.currency.toUpperCase() === currency &&
    price.unit_amount === point &&
    (RECURRING[offer] ? price.recurring?.interval === RECURRING[offer] : price.recurring === null)
  );
}

/** Which plan a Stripe Price is (any currency), from the catalog; null for other prices. */
export function planForPrice(priceId: string | undefined): "starter" | "studio" | null {
  if (!priceId) return null;
  const map = stripePriceMap();
  for (const c of CURRENCIES) {
    if (map[c].studio === priceId) return "studio";
    if (map[c].starter === priceId) return "starter";
  }
  return null;
}
