import * as Sentry from "@sentry/nextjs";
import { monitoringOptions, ownHostsOf } from "@/shared/lib/monitoring/options";
import { tagUnhandled } from "@/shared/lib/monitoring/report-client";
import { routeTemplate } from "@/shared/lib/monitoring/routes";
import { NAVIGATION_CRUMB } from "@/shared/lib/monitoring/sanitize";

/*
 * HEY-175: browser monitoring (Sentry). Off unless NEXT_PUBLIC_SENTRY_DSN is set. Page failures come from the error
 * boundaries (app/[locale]/error.tsx, app/global-error.tsx), uncaught errors and rejections from the SDK's global
 * handlers. The environment and release are set at build time by next.config.ts, equal to the server's.
 */
try {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    const options = monitoringOptions({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "dev",
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      ownHosts: [...ownHostsOf(process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SHORT_LINK_BASE), window.location.host],
    });
    Sentry.init({
      ...options,
      beforeSend: (event) => {
        try {
          return options.beforeSend(tagUnhandled(event));
        } catch {
          return null;
        }
      },
    });
  }
} catch {
  // Monitoring must never break the page.
}

/** Navigation breadcrumbs (route templates only) for errors that follow a navigation. */
export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  try {
    const path = new URL(url, window.location.origin).pathname;
    Sentry.addBreadcrumb({ category: NAVIGATION_CRUMB, message: `${navigationType} ${routeTemplate(path)}`, level: "info" });
  } catch {
    // ignore
  }
}
