import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/** Language negotiation and locale prefixes. API routes, short links (/r/…) and files are left alone. */
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|r/|_next|_vercel|.*\\..*).*)"],
};
