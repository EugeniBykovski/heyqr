import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALE_CODES } from "./locales";

/** English lives at "/", every other language at "/<code>/…". */
export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "as-needed",
});
