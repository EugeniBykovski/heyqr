import * as Sentry from "@sentry/nextjs";
import { newRef, safeId, SEVERITY_LEVEL, type Severity } from "@/shared/lib/monitoring/options";
import { routeTemplate } from "@/shared/lib/monitoring/routes";
import { stepOf } from "./monitoring-step";

/*
 * HEY-175: reporting an unexpected server failure on a critical path, with what identifies the failing step: the
 * operation (`checkout.create`, `stripe.webhook.fulfill`, …), the step inside it (monitoring-step.ts), the route
 * template, a correlation id (also in the server log line) and safe tags.
 *
 * Reporting never throws, never waits for the network and never changes a response: callers keep their own status,
 * redirect and retry behaviour. Reported errors are marked so Next's onRequestError doesn't send them twice.
 */
export type FailureReport = {
  operation: string;
  severity: Severity;
  /** The route template or path the failure happened on (ids are removed). */
  route?: string;
  /** A request id, Stripe event id or digest, when there is one; otherwise one is made. */
  correlationId?: string | null;
  /** Small, safe values that identify the step, e.g. { event_type: "checkout.session.completed", format: "png" }. */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** False when the caller already writes its own log line. */
  log?: boolean;
};

const REPORTED = Symbol.for("heyqr.monitoring.reported");

export function wasReported(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[REPORTED] === true;
}

/** The platform's request id (Vercel), or null. Only ids, never other header values. */
export function requestIdOf(headers: { get(name: string): string | null } | undefined): string | null {
  return safeId(headers?.get("x-vercel-id")) ?? safeId(headers?.get("x-request-id"));
}

/** The provider's error code (PostgreSQL, Stripe, Node): an identifier, never a message. */
function codeOf(error: unknown): string | undefined {
  for (const e of [error, error instanceof Error ? error.cause : undefined]) {
    const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,60}$/.test(code)) return code;
  }
  return undefined;
}

/** On Vercel, keeps the function alive until the event is sent; elsewhere the process lives on. Never awaited. */
function sendInBackground() {
  type Context = { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined };
  const context = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as Context | undefined;
  context?.get?.()?.waitUntil?.(Sentry.flush(2000).catch(() => false));
}

/** Reports one failure; returns the correlation id that was logged and sent. */
export function reportFailure(error: unknown, report: FailureReport): string {
  const ref = safeId(report.correlationId) ?? newRef();
  try {
    const name = error instanceof Error ? error.name : "unknown error";
    const step = stepOf(error);
    // The log line names the operation and the id, never the error's message (it can carry query parameters).
    if (report.log !== false) console.error(`[monitor] ${report.operation}${step ? ` at ${step}` : ""} failed: ${name} ref=${ref}`);
    if (typeof error === "object" && error !== null && Object.isExtensible(error)) Object.defineProperty(error, REPORTED, { value: true });
    const route = report.route ? routeTemplate(report.route) : undefined;
    const tags: Record<string, string> = { operation: report.operation, alert: report.severity, correlation_id: ref };
    for (const [k, v] of Object.entries({ route, step, error_code: codeOf(error), ...report.tags }))
      if (v !== undefined && v !== null) tags[k] = String(v);
    Sentry.captureException(error, {
      level: SEVERITY_LEVEL[report.severity],
      tags,
      // One issue per failing step and error kind, however many requests (or Stripe retries) hit it.
      fingerprint: ["heyqr", report.operation, step ?? "-", route ?? "-", name],
    });
    sendInBackground();
  } catch {
    // Monitoring must never affect the request.
  }
  return ref;
}

/** For `.catch(...)`: reports and rethrows the same error, so the response stays what it was. */
export const reportAndRethrow =
  (report: FailureReport) =>
  (error: unknown): never => {
    if (!wasReported(error)) reportFailure(error, report);
    throw error;
  };

/** A refused outcome that needs attention although nothing threw (e.g. a paid order that can't be granted). */
export function reportCondition(reason: string, report: FailureReport): string {
  const error = new Error(reason);
  error.name = "RefusedOutcome";
  return reportFailure(error, { ...report, log: false, tags: { reason, ...report.tags } });
}
