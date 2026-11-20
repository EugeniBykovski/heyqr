import "server-only";
import { cookies } from "next/headers";
import { CURRENCY_COOKIE, DEFAULT_CURRENCY, isCurrency, type Currency } from "@/shared/config/catalog";

/** Design 7.1: the viewer's currency (a cookie, independent of the language). Checkout charges in this currency. */
export async function getCurrency(): Promise<Currency> {
  const value = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return isCurrency(value) ? value : DEFAULT_CURRENCY;
}
