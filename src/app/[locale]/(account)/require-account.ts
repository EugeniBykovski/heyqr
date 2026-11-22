import "server-only";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/locales";
import { getSession } from "@/server/auth";

type Query = Record<string, string | string[] | undefined>;

/**
 * HEY-75: the account area's sign-in gate. A guest is sent to Google sign-in with this exact page (and its query) as
 * the return target, so a direct visit to e.g. /dashboard/billing or the receipt email's /dashboard/qr/{id} link
 * resumes there instead of the dashboard. The sign-in page still validates the target (safeReturnPath).
 */
export async function requireAccount(locale: Locale, path: string, query: Query = {}) {
  const session = await getSession();
  if (!session) {
    const keep = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
    const here = `${path}${keep ? `?${keep}` : ""}`;
    return redirect({ href: `/sign-in?next=${encodeURIComponent(here)}`, locale });
  }
  return session.user;
}
