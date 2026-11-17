import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import en from "../../messages/en.json";
import { routing } from "./routing";

type Messages = typeof en;

/** Deep-merges a translation over English, so a missing key shows English instead of a raw key. */
function withFallback(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const b = base[key];
    out[key] =
      value && typeof value === "object" && b && typeof b === "object"
        ? withFallback(b as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  if (locale === "en") return { locale, messages: en };
  const translated = await import(`../../messages/${locale}.json`).then((m: { default: Partial<Messages> }) => m.default).catch(() => ({}));
  return { locale, messages: withFallback(en, translated) as Messages };
});
