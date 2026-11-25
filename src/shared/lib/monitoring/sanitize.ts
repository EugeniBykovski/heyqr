import { isOwnPath, routeTemplate } from "./routes";

/*
 * HEY-175: what may leave HeyQR in a monitoring event. Runs in beforeSend / beforeBreadcrumb in the browser and on the
 * server, so every event is cleaned in one place, whatever captured it. It is an allowlist: the event is rebuilt from
 * the fields below and everything else (headers, cookies, bodies, queries, user, extra, local variables, source lines,
 * console / fetch / click breadcrumbs, host names) is left out. Text that stays is scrubbed. If cleaning fails, the
 * event is dropped (monitoringOptions), never sent as it was.
 */

const REPLACEMENTS: [RegExp, string][] = [
  // A failed query's message carries its parameters (QR content, Wi-Fi passwords, destinations): drop all of it.
  [/Failed query:[\s\S]*/g, "Failed query: [redacted]"],
  [/\bparams:[\s\S]*/gi, "params: [redacted]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[private-key]"],
  // QR payloads that aren't URLs.
  [/\b(WIFI|MATMSG|MECARD|SMSTO|mailto|tel|sms|geo|bitcoin):[^\n]*/gi, "[qr-payload]"],
  [/BEGIN:(VCARD|VEVENT|VCALENDAR)[\s\S]*/gi, "[qr-payload]"],
  [/data:[a-z]+\/[a-z0-9.+-]+[;,][^\s"'`]*/gi, "[data-uri]"],
  [/\bhqk_[A-Za-z0-9]+_[A-Za-z0-9_-]+/g, "[api-key]"],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9_]+/g, "[stripe-key]"],
  [/\bwhsec_[A-Za-z0-9_]+/g, "[stripe-webhook-secret]"],
  // Stripe object ids tied to a payment or customer. Event ids (evt_…) stay: they name the webhook delivery to resend.
  [/\b(cs|pi|ch|cus|sub|in|pm|seti|re|prod|price|ii|py|txn|src|card)_(live_|test_)?[A-Za-z0-9]{8,}/g, "[stripe-id]"],
  [/\bnpm_[A-Za-z0-9]{20,}/g, "[npm-token]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[authorization]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/\b(X-Amz-[A-Za-z-]+|[Ss]ignature|token|session_token|password|secret)=[^\s&"'`]+/g, "[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
];

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi;
const PATH_RE = /(^|[\s("'`=])(\/[A-Za-z][^\s"'`)<>]*)/g;
const QUOTED_RE = /(["'`])((?:(?!\1)[^\n]){1,500})\1/g;

/** Hosts whose paths may be kept (HeyQR itself); everything else is a third-party URL, e.g. a QR destination. */
export type SanitizeOptions = { ownHosts: string[] };

/** A URL as monitoring may see it: own pages as their route template, any other address as its kind only. */
export function scrubUrl(raw: string, opts: SanitizeOptions): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "[url]";
  }
  // Never the query (signed links, Checkout return parameters), the fragment or credentials.
  return /^https?:$/.test(url.protocol) && opts.ownHosts.includes(url.host)
    ? `${url.origin}${routeTemplate(url.pathname)}`
    : "[external-url]";
}

/** Replaces URLs, secrets, QR payloads and quoted values (interpolated data) in a message. */
export function scrubText(text: string, opts: SanitizeOptions): string {
  let out = text.slice(0, 4000);
  for (const [re, replacement] of REPLACEMENTS) out = out.replace(re, replacement);
  out = out.replace(URL_RE, (u) => scrubUrl(u, opts));
  out = out.replace(PATH_RE, (all, before: string, path: string) => (isOwnPath(path) ? `${before}${routeTemplate(path)}` : all));
  // "Cannot read properties of undefined (reading 'x')" names code, not data; other quoted text may be anything.
  out = out.replace(QUOTED_RE, (all, q: string, _inner: string, at: number, whole: string) =>
    /\((reading|setting) $/.test(whole.slice(Math.max(0, at - 10), at)) ? all : `${q}[value]${q}`,
  );
  return out.slice(0, 1000);
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pick = (from: Rec, keys: readonly string[]): Rec =>
  Object.fromEntries(keys.flatMap((k) => (from[k] === undefined ? [] : [[k, from[k]]])));

/** Where a frame's code is: HeyQR's own bundles keep their path, a third party's script doesn't. */
function frameFile(file: unknown, opts: SanitizeOptions): string | undefined {
  if (typeof file !== "string") return undefined;
  const clean = file.split(/[?#]/)[0] ?? "";
  if (!/^https?:\/\//.test(clean)) return clean;
  try {
    const url = new URL(clean);
    if (!opts.ownHosts.includes(url.host)) return "[external-url]";
    return `${url.origin}${url.pathname.startsWith("/_next/") ? url.pathname : routeTemplate(url.pathname)}`;
  } catch {
    return "[url]";
  }
}

function cleanFrame(frame: unknown, opts: SanitizeOptions): Rec {
  const f = rec(frame) ?? {};
  const out = pick(f, ["function", "module", "lineno", "colno", "in_app", "platform", "debug_id"]);
  for (const k of ["filename", "abs_path"]) {
    const file = frameFile(f[k], opts);
    if (file !== undefined) out[k] = file;
  }
  return out;
}

function cleanException(value: unknown, opts: SanitizeOptions): Rec {
  const v = rec(value) ?? {};
  const stack = rec(v.stacktrace);
  const mechanism = rec(v.mechanism);
  return {
    type: typeof v.type === "string" ? scrubText(v.type, opts).slice(0, 100) : "Error",
    ...(typeof v.value === "string" ? { value: scrubText(v.value, opts) } : {}),
    ...(stack ? { stacktrace: { frames: list(stack.frames).map((f) => cleanFrame(f, opts)) } } : {}),
    // Never mechanism.data (it can carry request or event-target details).
    ...(mechanism
      ? { mechanism: pick(mechanism, ["type", "handled", "synthetic", "exception_id", "parent_id", "source", "is_exception_group"]) }
      : {}),
  };
}

const PLAIN = ["event_id", "timestamp", "platform", "level", "release", "environment", "dist", "sdk", "debug_meta"] as const;
const CONTEXTS: Record<string, readonly string[]> = {
  runtime: ["name", "version"],
  os: ["name", "version"],
  browser: ["name", "version"],
  trace: ["trace_id", "span_id"],
};

/** The event as it may be sent: a new object with the allowed fields only (typed as the input, for the SDK's hooks). */
export function sanitizeEvent<T extends object>(event: T, opts: SanitizeOptions): T {
  const e = event as Rec;
  const out: Rec = pick(e, PLAIN);
  if (typeof e.message === "string") out.message = scrubText(e.message, opts);
  const tags = rec(e.tags);
  if (tags)
    out.tags = Object.fromEntries(
      Object.entries(tags).flatMap(([k, v]) =>
        v === undefined || v === null
          ? []
          : [[k, typeof v === "string" ? scrubText(v, opts).slice(0, 200) : typeof v === "object" ? "[object]" : v]],
      ),
    );
  const values = list(rec(e.exception)?.values);
  if (values.length) out.exception = { values: values.map((v) => cleanException(v, opts)) };
  const fingerprint = list(e.fingerprint).filter((f): f is string => typeof f === "string");
  if (fingerprint.length) out.fingerprint = fingerprint.map((f) => (/^\{\{.*\}\}$/.test(f) ? f : scrubText(f, opts)));
  const request = rec(e.request);
  if (request)
    out.request = {
      ...(typeof request.method === "string" ? { method: request.method } : {}),
      ...(typeof request.url === "string" ? { url: scrubUrl(request.url, opts) } : {}),
    };
  const contexts = rec(e.contexts);
  if (contexts)
    out.contexts = Object.fromEntries(
      Object.entries(CONTEXTS).flatMap(([name, keys]) => {
        const c = rec(contexts[name]);
        return c ? [[name, pick(c, keys)]] : [];
      }),
    );
  const crumbs = list(e.breadcrumbs).flatMap((c) => {
    const clean = rec(c) ? sanitizeBreadcrumb(c as object, opts) : null;
    return clean ? [clean] : [];
  });
  if (crumbs.length) out.breadcrumbs = crumbs;
  return out as T;
}

export const NAVIGATION_CRUMB = "heyqr.navigation";

/** Only HeyQR's own navigation steps ("push /dashboard/qr/[id]"); console, fetch and click breadcrumbs are dropped. */
export function sanitizeBreadcrumb<T extends object>(crumb: T, opts: SanitizeOptions): T | null {
  const c = crumb as Rec;
  if (c.category !== NAVIGATION_CRUMB || typeof c.message !== "string") return null;
  return { ...pick(c, ["timestamp", "category", "level"]), message: scrubText(c.message, opts) } as T;
}
