"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_CURRENCY, priceSheet, type Currency, type Offer } from "@/shared/config/catalog";

const CurrencyContext = createContext<Currency>(DEFAULT_CURRENCY);

/** Design 7.1: the viewer's currency (from the cookie, read on the server) for client components. */
export function CurrencyProvider({ value, children }: { value: Currency; children: ReactNode }) {
  return <CurrencyContext value={value}>{children}</CurrencyContext>;
}

/** The viewer's currency and the catalog's prices in it (minor units; null: not offered in that currency). */
export function usePrices(): { currency: Currency; cents: Record<Offer, number | null> } {
  const currency = useContext(CurrencyContext);
  return { currency, cents: priceSheet(currency) };
}
