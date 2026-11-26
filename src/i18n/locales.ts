/**
 * The 21 interface languages (order = language switch order). English is the default and the fallback.
 * `flag` is a Tailwind arbitrary `background` property drawn with CSS gradients, so no image or emoji font is needed.
 */
export const LOCALES = [
  {
    code: "en",
    short: "EN",
    native: "English",
    english: "English",
    flag: "[background:linear-gradient(#3C3B6E,#3C3B6E)_0_0/44%_54%_no-repeat,repeating-linear-gradient(#B22234_0_7.7%,#FFFFFF_7.7%_15.4%)]",
  },
  {
    code: "es",
    short: "ES",
    native: "Español",
    english: "Spanish",
    flag: "[background:linear-gradient(#AA151B_25%,#F1BF00_25%_75%,#AA151B_75%)]",
  },
  {
    code: "zh",
    short: "ZH",
    native: "中文",
    english: "Chinese",
    flag: "[background:radial-gradient(circle_at_24%_32%,#FFDE00_12%,transparent_13%),#DE2910]",
  },
  {
    code: "hi",
    short: "HI",
    native: "हिन्दी",
    english: "Hindi",
    flag: "[background:radial-gradient(circle,#000080_12%,transparent_13%),linear-gradient(#FF9933_33.3%,#FFFFFF_33.3%_66.6%,#138808_66.6%)]",
  },
  {
    code: "ar",
    short: "AR",
    native: "العربية",
    english: "Arabic",
    flag: "[background:linear-gradient(90deg,#FF0000_26%,transparent_26%),linear-gradient(#00732F_33.3%,#FFFFFF_33.3%_66.6%,#000000_66.6%)]",
  },
  {
    code: "pt",
    short: "PT",
    native: "Português",
    english: "Portuguese",
    flag: "[background:radial-gradient(circle,#002776_20%,transparent_21%),radial-gradient(ellipse_44%_38%_at_50%_50%,#FEDF00_98%,transparent_100%),#009C3B]",
  },
  {
    code: "fr",
    short: "FR",
    native: "Français",
    english: "French",
    flag: "[background:linear-gradient(90deg,#0055A4_33.3%,#FFFFFF_33.3%_66.6%,#EF4135_66.6%)]",
  },
  {
    code: "de",
    short: "DE",
    native: "Deutsch",
    english: "German",
    flag: "[background:linear-gradient(#000000_33.3%,#DD0000_33.3%_66.6%,#FFCE00_66.6%)]",
  },
  {
    code: "ru",
    short: "RU",
    native: "Русский",
    english: "Russian",
    flag: "[background:linear-gradient(#FFFFFF_33.3%,#0039A6_33.3%_66.6%,#D52B1E_66.6%)]",
  },
  { code: "ja", short: "JA", native: "日本語", english: "Japanese", flag: "[background:radial-gradient(circle,#BC002D_28%,#FFFFFF_29%)]" },
  {
    code: "ko",
    short: "KO",
    native: "한국어",
    english: "Korean",
    flag: "[background:radial-gradient(circle,transparent_25%,#FFFFFF_26%),linear-gradient(#CD2E3A_50%,#0047A0_50%)]",
  },
  {
    code: "it",
    short: "IT",
    native: "Italiano",
    english: "Italian",
    flag: "[background:linear-gradient(90deg,#009246_33.3%,#FFFFFF_33.3%_66.6%,#CE2B37_66.6%)]",
  },
  {
    code: "tr",
    short: "TR",
    native: "Türkçe",
    english: "Turkish",
    flag: "[background:radial-gradient(circle_at_44%_50%,#E30A17_20%,transparent_21%),radial-gradient(circle_at_38%_50%,#FFFFFF_26%,transparent_27%),#E30A17]",
  },
  {
    code: "id",
    short: "ID",
    native: "Bahasa Indonesia",
    english: "Indonesian",
    flag: "[background:linear-gradient(#CE1126_50%,#FFFFFF_50%)]",
  },
  {
    code: "vi",
    short: "VI",
    native: "Tiếng Việt",
    english: "Vietnamese",
    flag: "[background:radial-gradient(circle,#FFFF00_20%,transparent_21%),#DA251D]",
  },
  { code: "pl", short: "PL", native: "Polski", english: "Polish", flag: "[background:linear-gradient(#FFFFFF_50%,#DC143C_50%)]" },
  { code: "uk", short: "UK", native: "Українська", english: "Ukrainian", flag: "[background:linear-gradient(#0057B7_50%,#FFD700_50%)]" },
  {
    code: "be",
    short: "BE",
    native: "Беларуская",
    english: "Belarusian",
    flag: "[background:repeating-linear-gradient(#C8313E_0_9%,#FFFFFF_9%_18%)_0_0/12%_100%_no-repeat,linear-gradient(#C8313E_66.6%,#4AA657_66.6%)]",
  },
  {
    code: "nl",
    short: "NL",
    native: "Nederlands",
    english: "Dutch",
    flag: "[background:linear-gradient(#AE1C28_33.3%,#FFFFFF_33.3%_66.6%,#21468B_66.6%)]",
  },
  {
    code: "th",
    short: "TH",
    native: "ไทย",
    english: "Thai",
    flag: "[background:linear-gradient(#A51931_16.6%,#F4F5F8_16.6%_33.3%,#2D2A4A_33.3%_66.6%,#F4F5F8_66.6%_83.3%,#A51931_83.3%)]",
  },
  {
    code: "sv",
    short: "SV",
    native: "Svenska",
    english: "Swedish",
    flag: "[background:linear-gradient(90deg,transparent_30%,#FECC00_30%_44%,transparent_44%),linear-gradient(transparent_40%,#FECC00_40%_60%,transparent_60%),#006AA7]",
  },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export const LOCALE_CODES = LOCALES.map((l) => l.code) as [Locale, ...Locale[]];
export const DEFAULT_LOCALE: Locale = "en";
export const RTL_LOCALES: readonly Locale[] = ["ar"];
/** The document's `dir` for a locale: Arabic reads right to left, every other interface language left to right. */
export const textDirection = (locale: string): "rtl" | "ltr" => ((RTL_LOCALES as readonly string[]).includes(locale) ? "rtl" : "ltr");
export const localeMeta = (code: string) => LOCALES.find((l) => l.code === code) ?? LOCALES[0];
