import type { Instrumentation } from "next";

/*
 * HEY-175: server monitoring (Sentry), set up once per server instance. Off unless SENTRY_DSN is set.
 * onRequestError reports failures Next catches while rendering pages, running route handlers and server actions,
 * unless our own reporting (server/monitoring.ts) already sent them with their operation.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    const { monitoringOptions, ownHostsOf } = await import("@/shared/lib/monitoring/options");
    const { resolveAppEnv } = await import("@/shared/config/app-env");
    Sentry.init({
      ...monitoringOptions({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || resolveAppEnv(),
        release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
        ownHosts: ownHostsOf(process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SHORT_LINK_BASE),
      }),
      enableOpenTelemetrySetup: false,
    });
  } catch {
    // The server starts without monitoring rather than not at all.
    console.error("[monitor] could not start; failures are not being reported");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  try {
    const { wasReported, reportFailure, requestIdOf } = await import("@/server/monitoring");
    const { areaOf, isCheckoutReturn, routeTemplate } = await import("@/shared/lib/monitoring/routes");
    const { safeId } = await import("@/shared/lib/monitoring/options");
    if (wasReported(error)) return;
    const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
    // Redirects, not-found and a visitor who left are outcomes, not failures.
    if (digest?.startsWith("NEXT_") || (error instanceof Error && error.name === "ResponseAborted")) return;
    const get = (name: string) => {
      const v = request.headers[name];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    };
    const route = routeTemplate(context.routePath.replace(/^\/?(src\/)?app(?=\/)/, ""));
    const area = areaOf(route, isCheckoutReturn(request.path.split("?")[1] ?? ""));
    const critical = area === "api" ? /^\/api\/(export|print\/files|stripe|billing)(\/|$)/.test(route) : area !== "other";
    reportFailure(error, {
      operation: area === "qr_access" ? (route.startsWith("/r/") ? "qr.redirect" : "qr.page") : `request.${context.routeType}`,
      severity: critical ? "high" : "low",
      route,
      correlationId: safeId(digest) ?? requestIdOf({ get }),
      tags: { area, method: request.method, route_type: context.routeType, render_source: context.renderSource },
    });
  } catch {
    // Monitoring must never affect the response.
  }
};
