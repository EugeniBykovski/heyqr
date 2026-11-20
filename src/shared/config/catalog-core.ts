/*
 * Design 4.8 catalog constants that don't depend on configuration: the currencies (USD / EUR / PLN), offers, plans,
 * Static Pack sizes and how money is written. Safe to import anywhere (no environment access).
 */
export const CURRENCIES = ["USD", "EUR", "PLN"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_COOKIE = "heyqr_currency";
export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

export const OFFERS = ["single", "pack3", "pack10", "starter", "studio", "printPack"] as const;
export type Offer = (typeof OFFERS)[number];

/** Design PLANS: live Dynamic slots, static unlocks and included Print Packs per billing month. */
export const PLANS = {
  starter: { id: "starter", dyn: 5, unlocks: 10, packs: 0 },
  studio: { id: "studio", dyn: 25, unlocks: 40, packs: 5 },
} as const;
export type PlanId = keyof typeof PLANS;
export const isPlanId = (v: unknown): v is PlanId => v === "starter" || v === "studio";

/** Static Packs: credits per pack. One credit unlocks one static QR; credits don't expire. */
export const PACK_CREDITS = { pack3: 3, pack10: 10 } as const;

/** Design MONEY_LOCALE: each currency is written the way its market writes it ($4.99, €4.99, 19,99 zł). */
const MONEY_LOCALE: Record<Currency, string> = { USD: "en-US", EUR: "en-IE", PLN: "pl-PL" };

/** A price in minor units, formatted for its currency; "—" when the offer has no price in that currency. */
export function formatMoney(cents: number | null, currency: Currency): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat(MONEY_LOCALE[currency], { style: "currency", currency }).format(cents / 100);
}
