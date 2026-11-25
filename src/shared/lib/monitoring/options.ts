import { sanitizeBreadcrumb, sanitizeEvent } from "./sanitize";

/*
 * HEY-175: one Sentry configuration for the browser and the server. Monitoring is off unless a DSN is set; it sends
 * errors only (no traces, sessions, replays, logs or personal data) and every event passes the sanitizer.
 *
 * Severity, as the `alert` tag the alert rules read (docs/MONITORING.md):
 *   critical  money: Checkout creation, webhook fulfillment, a paid order that wasn't granted
 *   high      QR access, paid files, and pages of the editor, dashboard, export and checkout return
 *   low       still unexpected, but the buyer or scanner isn't blocked
 * Expected outcomes (cancelled Checkout, 401/402/403/404, unavailable QR codes) are responses: nothing reports them.
 */
export type Severity = "critical" | "high" | "low";

export const SEVERITY_LEVEL = { critical: "fatal", high: "error", low: "warning" } as const;

export type MonitoringSettings = {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  /** Hosts whose page paths may be kept in events (HeyQR's app and short-link hosts). */
  ownHosts: string[];
};

/** Framework control flow and browser noise that is never a failure. */
export const IGNORED_ERRORS = [
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "NEXT_HTTP_ERROR_FALLBACK",
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
];

/**
 * The SDK parts that run, by name. Everything else is off, so monitoring adds no request instrumentation, no headers on
 * outgoing calls (Stripe, storage), no process-level handlers and no telemetry that skips beforeSend. Not Dedupe: it
 * drops a repeat of the previous error, so an outage would count once and frequency alerts would never fire; the
 * fingerprints group repeats instead.
 */
const INTEGRATIONS = new Set([
  "InboundFilters",
  "EventFilters",
  "FunctionToString",
  "LinkedErrors",
  "Context",
  "GlobalHandlers",
  "HttpContext",
  "BrowserApiErrors",
  "TryCatch",
]);

export function monitoringOptions(s: MonitoringSettings) {
  const opts = { ownHosts: s.ownHosts };
  return {
    dsn: s.dsn,
    enabled: Boolean(s.dsn),
    environment: s.environment,
    ...(s.release ? { release: s.release } : {}),
    tracePropagationTargets: [],
    // The SDK collects these by default (userInfo also makes Sentry store the visitor's IP address).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    sendClientReports: false,
    maxBreadcrumbs: 20,
    ignoreErrors: IGNORED_ERRORS,
    integrations: <I extends { name: string }>(defaults: I[]): I[] => defaults.filter((i) => INTEGRATIONS.has(i.name)),
    // Fails closed: an event that can't be cleaned isn't sent.
    beforeSend: <T extends object>(event: T): T | null => {
      try {
        return sanitizeEvent(event, opts);
      } catch {
        return null;
      }
    },
    beforeBreadcrumb: <T extends object>(crumb: T): T | null => {
      try {
        return sanitizeBreadcrumb(crumb, opts);
      } catch {
        return null;
      }
    },
  };
}

/** Hosts of the app and short-link origins, for the sanitizer. */
export function ownHostsOf(...urls: (string | undefined)[]): string[] {
  const hosts = urls.flatMap((u) => {
    try {
      return u ? [new URL(u).host] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)];
}

/** An id that may be sent and shown: a request id, an error digest, a Stripe event id. Anything else is refused. */
export const safeId = (id: unknown): string | null =>
  typeof id === "string" && /^[A-Za-z0-9:_@.-]{1,128}$/.test(id) && !id.startsWith("NEXT_") ? id : null;

export function newRef(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ref-${Date.now().toString(36)}`;
  }
}
