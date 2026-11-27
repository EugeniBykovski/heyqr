import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import en from "../../messages/en.json";
import { routing } from "./routing";

type Messages = typeof en;

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Deep-merges a translation over English, so a missing key shows English instead of a raw key. Only plain objects are
 * merged key by key; an array (a docs page's blocks, a list of items) is taken whole from the translation. Merging two
 * arrays as objects turned them into {"0": …, "1": …}, and every translated /developers page failed (HEY-172).
 */
export function withFallback(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const b = base[key];
    out[key] = isRecord(value) && isRecord(b) ? withFallback(b, value) : value;
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
