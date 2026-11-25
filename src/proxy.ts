import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/** Language negotiation and locale prefixes. API routes, short links (/r/…) and files are left alone. */
export default createMiddleware(routing);

export const config = {
  // r/ (short links) and p/ (public hosted pages) are locale-free: the printed code's URL never changes with language.
  matcher: ["/((?!api|r/|p/|_next|_vercel|.*\\..*).*)"],
};
