/*
 * HEY-176 / QR-24.02: checks, from outside the deployed app, that a permanent Dynamic QR short link still redirects to
 * its destination (docs/SHORT_LINK_PROBE.md). One GET without cookies, session or API key, redirects not followed.
 * Passes only on 302 + the exact Location + Cache-Control: no-store.
 *
 *   node scripts/short-link-probe.ts            configuration from SHORT_LINK_PROBE_* (see below)
 *   node scripts/short-link-probe.ts --local    a loopback fixture over http; never counts as an external check
 *
 * Exit code: 0 passed, 1 failed, 2 misconfigured. No dependencies, so CI runs it without an install. The output and the
 * Sentry event name what was wrong, never the address that was answered: CI logs of this repository are public.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** HEY-146's marker for test traffic, as in src/server/qr/scans.ts (a test keeps the two equal). */
export const TEST_TRAFFIC_HEADER = "x-heyqr-test";
export const DEFAULT_TIMEOUT_MS = 10_000;

export type ProbeConfig = { url: string; destination: string; environment: string; timeoutMs: number; local: boolean };
export type FailureKind = "timeout" | "network" | "status" | "missing_location" | "unavailable_page" | "unexpected_target" | "cacheable";
export type ProbeResult = { ok: true; ms: number } | { ok: false; kind: FailureKind; detail: string; ms: number };

type Env = Record<string, string | undefined>;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** The probe's settings, or what is wrong with them (variable names and reasons, never values). */
export function readConfig(env: Env, local = false): { config: ProbeConfig } | { problems: string[] } {
  const problems: string[] = [];
  const check = (name: string, expectLocal: boolean): string => {
    const raw = env[name]?.trim() ?? "";
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`${name} must be ${raw ? "a valid URL" : "set"}`);
      return raw;
    }
    if (url.username || url.password) problems.push(`${name} must not carry credentials`);
    const loopback = LOOPBACK.test(url.hostname);
    if (expectLocal ? !loopback : loopback)
      problems.push(`${name} must be ${expectLocal ? "a loopback address with --local" : "public, not loopback"}`);
    if (!expectLocal && url.protocol !== "https:") problems.push(`${name} must be https`);
    return raw;
  };
  const url = check("SHORT_LINK_PROBE_URL", local);
  const destination = check("SHORT_LINK_PROBE_DESTINATION", false);
  if (URL.canParse(url) && (new URL(url).search || new URL(url).hash)) problems.push("SHORT_LINK_PROBE_URL must be the bare short link");
  if (URL.canParse(destination) && isUnavailablePage(new URL(destination)))
    problems.push("SHORT_LINK_PROBE_DESTINATION must not be the unavailable page");
  const timeoutMs = Number(env.SHORT_LINK_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) problems.push("SHORT_LINK_PROBE_TIMEOUT_MS must be 1–60000");
  const environment = env.SHORT_LINK_PROBE_ENVIRONMENT || "production";
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(environment)) problems.push("SHORT_LINK_PROBE_ENVIRONMENT must be a short lowercase name");
  return problems.length ? { problems } : { config: { url, destination, environment, timeoutMs, local } };
}

/** The app's "link unavailable" page, with or without a locale prefix. */
function isUnavailablePage(url: URL): boolean {
  return /^(\/[a-z]{2}(-[A-Za-z]{2,4})?)?\/link-unavailable\/?$/.test(url.pathname);
}

/** Judges one answer. Pure. */
export function judge(
  res: { status: number; headers: Pick<Headers, "get"> },
  config: ProbeConfig,
): { kind: FailureKind; detail: string } | null {
  const location = res.headers.get("location");
  const target = location !== null && URL.canParse(location, config.url) ? new URL(location, config.url) : null;
  // Said first, whatever the status: it is the app's own answer that the code isn't live.
  if (target && isUnavailablePage(target) && location !== config.destination)
    return {
      kind: "unavailable_page",
      detail: `redirected to the unavailable page${target.searchParams.get("reason") === "inactive" ? " (reason: inactive)" : ""}`,
    };
  if (res.status !== 302) return { kind: "status", detail: `expected HTTP 302, got ${res.status}` };
  if (location === null) return { kind: "missing_location", detail: "302 without a Location" };
  if (location !== config.destination) {
    const expected = new URL(config.destination);
    const where = !target
      ? "not a URL"
      : target.origin !== expected.origin
        ? "another origin"
        : "same origin, different path, query or spelling";
    return { kind: "unexpected_target", detail: `Location isn't the expected destination (${where})` };
  }
  const directives = (res.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((d) => d.trim());
  if (!directives.includes("no-store")) return { kind: "cacheable", detail: "Cache-Control isn't no-store" };
  return null;
}

/** One request. Never throws: no answer in time, or no answer at all, is a failed check. */
export async function probe(config: ProbeConfig, request: typeof fetch = fetch): Promise<ProbeResult> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const res = await request(config.url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: { [TEST_TRAFFIC_HEADER]: "1", "user-agent": "HeyQR-short-link-probe/1" },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const problem = judge(res, config);
    await res.body?.cancel().catch(() => undefined);
    return problem ? { ok: false, ...problem, ms: ms() } : { ok: true, ms: ms() };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      return { ok: false, kind: "timeout", detail: `no answer within ${config.timeoutMs} ms`, ms: ms() };
    const code = error instanceof Error ? (error.cause as { code?: unknown } | undefined)?.code : undefined;
    const safe = typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? ` (${code})` : "";
    return { ok: false, kind: "network", detail: `request failed${safe}`, ms: ms() };
  }
}

type Failure = Extract<ProbeResult, { ok: false }>;

/**
 * Reports a failed check to HEY-175's Sentry project with the tags its alert rules read. Fixed values only: no short
 * link, destination or answered address. Returns whether Sentry accepted it; never throws.
 */
export async function alertFailure(
  failure: Failure,
  context: { dsn: string | undefined; environment: string; runId?: string; drill?: boolean },
  request: typeof fetch = fetch,
): Promise<"sent" | "off" | "failed"> {
  if (!context.dsn) return "off";
  try {
    const dsn = new URL(context.dsn);
    const parts = dsn.pathname.split("/");
    const project = parts.pop();
    if (!dsn.username || !project || !/^https?:$/.test(dsn.protocol)) return "failed";
    const eventId = crypto.randomUUID().replaceAll("-", "");
    const correlation = context.runId && /^[A-Za-z0-9-]{1,60}$/.test(context.runId) ? `probe-${context.runId}` : eventId;
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "other",
      level: "error",
      environment: context.environment,
      message: `Short link probe failed: ${failure.kind}`,
      tags: {
        operation: "probe.short_link",
        alert: "high",
        area: "qr_access",
        route: "/r/[code]",
        step: failure.kind,
        correlation_id: correlation,
        drill: String(context.drill === true),
      },
      fingerprint: ["heyqr", "probe.short_link", context.environment, failure.kind, context.drill ? "drill" : "real"],
    };
    const endpoint = `${dsn.origin}${parts.join("/")}/api/${project}/envelope/`;
    const res = await request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.username}, sentry_client=heyqr-probe/1`,
      },
      body: `${JSON.stringify({ event_id: eventId })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** The whole run; returns the exit code. */
export async function main(
  env: Env,
  args: string[],
  log: (line: string) => void = console.log,
  request: typeof fetch = fetch,
): Promise<0 | 1 | 2> {
  const local = args.includes("--local");
  const read = readConfig(env, local);
  if ("problems" in read) {
    log("short link probe: NOT RUN, misconfigured");
    for (const p of read.problems) log(`  - ${p}`);
    return 2;
  }
  const { config } = read;
  // A drill expects a destination that can't be right, so a healthy link fails on purpose and the alert path is tested.
  const drill = env.SHORT_LINK_PROBE_DRILL === "true";
  const result = await probe(drill ? { ...config, destination: "https://probe-drill.invalid/" } : config, request);
  const label = `short link probe [${config.environment}]${local ? " LOCAL FIXTURE, not an external check" : ""}${drill ? " DRILL (wrong expected destination on purpose)" : ""}`;
  if (result.ok) {
    log(`${label}: passed in ${result.ms} ms`);
    return 0;
  }
  log(`${label}: FAILED ${result.kind}: ${result.detail} (${result.ms} ms)`);
  const alert = await alertFailure(
    result,
    { dsn: env.SHORT_LINK_PROBE_SENTRY_DSN, environment: config.environment, runId: env.GITHUB_RUN_ID, drill },
    request,
  );
  log(
    `  alert: ${{ sent: "sent to Sentry", off: "Sentry not configured, only this run shows the failure", failed: "Sentry did not accept the event" }[alert]}`,
  );
  return 1;
}

// Not import.meta.main: Node 22 lacks it, and a probe that does nothing would exit 0.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.env, process.argv.slice(2));
