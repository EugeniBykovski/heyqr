import "server-only";
import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/locales";
import { routing } from "@/i18n/routing";

/**
 * Public hosted pages have no locale in their URL (the printed code never changes): the visitor's browser language
 * picks the page language when HeyQR has it, otherwise English. The owner's content is shown as written.
 */
export async function visitorLocale(): Promise<Locale> {
  const accept = (await headers()).get("accept-language") ?? "";
  const wanted = accept
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .filter(Boolean);
  const locales = routing.locales;
  for (const w of wanted) {
    const exact = locales.find((l) => l.toLowerCase() === w);
    if (exact) return exact;
    const base = locales.find((l) => l.toLowerCase() === w.split("-")[0]);
    if (base) return base;
  }
  return routing.defaultLocale;
}

/** Every public page and layout renders on its own: each sets the visitor's language before translating. */
export async function applyVisitorLocale(): Promise<Locale> {
  const locale = await visitorLocale();
  setRequestLocale(locale);
  return locale;
}
