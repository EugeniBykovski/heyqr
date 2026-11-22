/**
 * HEY-73: where sign-in may send the visitor afterwards. Only same-origin paths under the app's own routes that a
 * sign-in can lead back to; anything else (other sites, "/\evil.example" which browsers read as "//evil.example",
 * API routes, unknown pages) falls back to the dashboard. Shared by the sign-in page's own redirect and the
 * callbackURL / errorCallbackURL it gives Better Auth (which validates those against trustedOrigins as well).
 */
const RETURN_ROUTES = ["/create", "/dashboard", "/edit", "/print", "/pricing"] as const;
const FALLBACK = "/dashboard";
const BASE = "http://app.invalid";

export function safeReturnPath(next: string | string[] | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.length > 2048) return FALLBACK;
  // Backslashes and control characters are rewritten or dropped by browsers before navigating.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== BASE) return FALLBACK;
  const allowed = RETURN_ROUTES.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`));
  return allowed ? `${url.pathname}${url.search}` : FALLBACK;
}
