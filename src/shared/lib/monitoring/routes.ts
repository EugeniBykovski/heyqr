import { LOCALES } from "@/i18n/locales";

/*
 * HEY-175: route templates for monitoring. Only segments that are known static parts of HeyQR's own routes are kept;
 * everything else (ids, short codes, anything a visitor typed) becomes a placeholder. routes.test.ts checks the list
 * against src/app, so a new page can't silently lose its name.
 */
export const STATIC_SEGMENTS = new Set(
  (
    "a all api api-keys assets auth billing content create dashboard destination developers edit export files health hosted " +
    "layouts link-unavailable logo notify p pdf preview pricing print privacy qr qr-codes r reader-wasm receipt report sample " +
    "scan sign-in stripe terms trial v1 webhook"
  ).split(" "),
);

const LOCALE_CODES = new Set<string>(LOCALES.map((l) => l.code));

/**
 * The route a path or a route file belongs to: `/de/dashboard/qr/Q8d3` and `/[locale]/(account)/dashboard/qr/[id]/page`
 * → `/dashboard/qr/[id]`; `/r/AbCdEf2` → `/r/[code]`. The locale is dropped, so one page is one route in every language.
 */
export function routeTemplate(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter((s) => s !== "" && !/^\(.*\)$/.test(s));
  const last = parts.at(-1);
  if (last === "page" || last === "route") parts.pop();
  if (parts[0] === "[locale]" || LOCALE_CODES.has(parts[0] ?? "")) parts.shift();
  const out = parts.map((seg, i) => {
    const prev = parts[i - 1];
    if ((prev === "r" || prev === "p") && i === 1) return "[code]";
    // A catch-all or named parameter of a route file; a concrete value can't look like this with a safe name.
    if (/^\[(\.\.\.)?[A-Za-z]{1,20}\]$/.test(seg)) return /^\[\.\.\./.test(seg) ? "[...]" : "[id]";
    // Static names right after a resource are ids there ("/dashboard/qr/<id>"); known words stay known words.
    return STATIC_SEGMENTS.has(seg) ? seg : "[id]";
  });
  return `/${out.join("/")}`;
}

/** Whether a path starts like one of HeyQR's own routes (to template relative paths found in messages). */
export function isOwnPath(pathname: string): boolean {
  const parts = pathname.split(/[/?#]/).filter(Boolean);
  if (LOCALE_CODES.has(parts[0] ?? "")) parts.shift();
  return STATIC_SEGMENTS.has(parts[0] ?? "");
}

export type Area = "checkout_return" | "export" | "editor" | "dashboard" | "print" | "qr_access" | "api" | "other";

/** The product area of a route template. `returning`: the address carries Checkout's return marker. */
export function areaOf(route: string, returning = false): Area {
  if (/^\/api(\/|$)/.test(route)) return "api";
  if (returning && /^\/(create\/export|dashboard|print)(\/|$)/.test(route)) return "checkout_return";
  if (/^\/create\/export(\/|$)/.test(route)) return "export";
  if (/^\/(create|edit)(\/|$)/.test(route)) return "editor";
  if (/^\/dashboard(\/|$)/.test(route)) return "dashboard";
  if (/^\/print(\/|$)/.test(route)) return "print";
  if (/^\/(r|p)(\/|$)/.test(route)) return "qr_access";
  return "other";
}

/** Checkout's return marker in a query string (success or cancelled); its values are never sent. */
export const isCheckoutReturn = (search: string): boolean => new URLSearchParams(search).has("checkout");
