"use client";

import * as Sentry from "@sentry/nextjs";
import { newRef, safeId, SEVERITY_LEVEL, type Severity } from "./options";
import { areaOf, isCheckoutReturn, routeTemplate } from "./routes";

/*
 * HEY-175: browser failures. Pages of the editor, dashboard, export, print and checkout return alert as high, others
 * as low. Only the route template and the area are sent, never the path's ids or the query's values.
 */
export type Place = { pathname: string; search: string; online?: boolean };

const isLoadFailure = (name: string, message: string) =>
  name === "ChunkLoadError" ||
  /failed to load chunk|loading (css )?chunk|dynamically imported module|importing a module script failed/i.test(message);

/** What the failure is and how urgent, from the error and where it happened. Pure. */
export function describeBrowserFailure(
  error: { name: string; message: string; fromServer: boolean },
  place: Place,
  caught: "boundary" | "unhandled",
) {
  const route = routeTemplate(place.pathname);
  const area = areaOf(route, isCheckoutReturn(place.search));
  const load = isLoadFailure(error.name, error.message);
  const operation = load ? "navigation.load" : caught === "boundary" ? "page.render" : "browser.unhandled";
  // Already alerted by the server (its digest is the correlation id) · the visitor is offline · an uncaught error that
  // didn't take the page down (often an extension): recorded, not alerted.
  const quiet = error.fromServer || place.online === false || operation === "browser.unhandled";
  const severity: Severity = !quiet && area !== "other" ? "high" : "low";
  return { route, area, operation, severity, fingerprint: ["heyqr", operation, route, error.name] };
}

const here = (): Place => ({ pathname: window.location.pathname, search: window.location.search, online: navigator.onLine });
const reported = new WeakMap<object, string>();

/** Reports a page an error boundary caught, once per error. Returns the reference shown on the error page. */
export function reportPageFailure(error: unknown, boundary: "segment" | "global"): string {
  const key = typeof error === "object" && error !== null ? error : null;
  const before = key ? reported.get(key) : undefined;
  if (before) return before;
  const digest = key && "digest" in key ? safeId(key.digest) : null;
  const ref = digest ?? newRef();
  if (key) reported.set(key, ref);
  try {
    const name = error instanceof Error ? error.name : "unknown";
    const message = error instanceof Error ? error.message : "";
    const d = describeBrowserFailure({ name, message, fromServer: digest !== null }, here(), "boundary");
    Sentry.captureException(error, {
      level: SEVERITY_LEVEL[d.severity],
      tags: {
        operation: d.operation,
        alert: d.severity,
        route: d.route,
        area: d.area,
        boundary,
        correlation_id: ref,
        from_server: digest !== null,
      },
      fingerprint: d.fingerprint,
    });
  } catch {
    // Monitoring must never break the error page.
  }
  return ref;
}

type BrowserEvent = { tags?: object; exception?: { values?: { type?: string; value?: string }[] } };

/** Gives errors the SDK caught by itself (uncaught errors, rejections) the same tags and grouping as reported ones. */
export function tagUnhandled<T extends object>(event: T, place: Place = here()): T {
  const e = event as BrowserEvent;
  if (e.tags && "operation" in e.tags) return event;
  const last = e.exception?.values?.at(-1);
  const d = describeBrowserFailure({ name: last?.type ?? "unknown", message: last?.value ?? "", fromServer: false }, place, "unhandled");
  return {
    ...event,
    level: SEVERITY_LEVEL[d.severity],
    tags: { ...e.tags, operation: d.operation, alert: d.severity, route: d.route, area: d.area, correlation_id: newRef() },
    ...(d.operation === "navigation.load" ? { fingerprint: d.fingerprint } : {}),
  };
}
