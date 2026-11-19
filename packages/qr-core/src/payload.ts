/** Content types a HeyQR code can hold and how each is encoded into the symbol. */

export type QrContent =
  | { type: "website"; url: string }
  | { type: "text"; text: string }
  | { type: "wifi"; ssid: string; security: "WPA" | "WEP" | "nopass"; password?: string; hidden?: boolean }
  | {
      type: "contact";
      firstName?: string;
      lastName?: string;
      title?: string;
      company?: string;
      phone?: string;
      email?: string;
      website?: string;
    }
  | { type: "email"; to: string; subject?: string; body?: string }
  | { type: "phone"; number: string }
  | { type: "sms"; number: string; message?: string }
  | { type: "location"; name?: string; address: string }
  | { type: "event"; title: string; start: string; end?: string; place?: string };

export type QrContentType = QrContent["type"];

export const QR_CONTENT_TYPES: readonly QrContentType[] = [
  "website",
  "text",
  "wifi",
  "contact",
  "email",
  "phone",
  "sms",
  "location",
  "event",
];

/** Trims and prefixes https:// when the user typed a bare domain; an explicit http:// or https:// is kept. */
export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export type WebsiteUrlProblem = "empty" | "spaces" | "invalid";

/**
 * The single check for a Website destination: the normalized URL (path, query and fragment kept) or why it can't be used.
 * Rejects blank input, spaces, other schemes (ftp://, mailto:, javascript:…), credentials and hosts without a dot.
 */
export function parseWebsiteUrl(input: string): { ok: true; url: string } | { ok: false; problem: WebsiteUrlProblem } {
  const value = normalizeUrl(input);
  if (!value) return { ok: false, problem: "empty" };
  if (/\s/.test(value)) return { ok: false, problem: "spaces" };
  try {
    const url = new URL(value);
    const ok = (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && url.hostname.includes(".");
    return ok ? { ok: true, url: value } : { ok: false, problem: "invalid" };
  } catch {
    return { ok: false, problem: "invalid" };
  }
}

const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
const digits = (s: string) => s.replace(/[^+\d]/g, "");
/** "2026-12-05T19:00" → "20261205T190000" (floating local time, as calendar apps expect). */
const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15).padEnd(15, "0");
/** A date without a time ("2026-12-05"): an all-day event. */
const isDateOnly = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
const compactDate = (iso: string) => iso.trim().replace(/-/g, "");
/** The day after a date, for an all-day event's exclusive DTEND (RFC 5545 3.6.1). */
function nextDay(iso: string): string {
  const d = new Date(`${iso.trim()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
/** DTSTART / DTEND lines: timed events as before; a date-only start is an all-day event (VALUE=DATE). */
function icsEventDates(start: string, end?: string): string[] {
  if (!isDateOnly(start)) return [`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end ?? start)}`];
  const endDate = end && isDateOnly(end) && end.trim() > start.trim() ? compactDate(end) : nextDay(start);
  return [`DTSTART;VALUE=DATE:${compactDate(start)}`, `DTEND;VALUE=DATE:${endDate}`];
}

type Contact = Extract<QrContent, { type: "contact" }>;

/** vCard version written for Contact codes (RFC 2426), the one phone camera apps read most reliably. */
export const VCARD_VERSION = "3.0";

/**
 * vCard 3.0 TEXT escaping (RFC 2426 §4): backslash, semicolon and comma are backslash-escaped and a line break
 * becomes "\n", so an embedded newline can never start a new property and punctuation stays distinct from the
 * component separators of structured values (N, ORG). Applied exactly once, to the raw value.
 */
const vText = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[\\;,]/g, "\\$&")
    .replace(/\n/g, "\\n");
/** URI and phone values are not TEXT: they are not escaped, but a line break can't be allowed to end the property. */
const vLine = (s: string) => s.replace(/[\r\n]+/g, " ");
const enc = new TextEncoder();

/** Folds a content line at 75 octets (RFC 2425 §5.8.1) with CRLF + space, never splitting a UTF-8 character. */
function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with one space
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

/**
 * Contact card as vCard 3.0, UTF-8, CRLF line endings, folded at 75 octets. Empty optional properties are left out;
 * FN (required by the format) is the full name, falling back to the company.
 */
export function encodeVCard(contact: Contact): string {
  const v = (k: keyof Omit<Contact, "type">) => (contact[k] ?? "").trim();
  const first = v("firstName");
  const last = v("lastName");
  const fullName = [first, last].filter(Boolean).join(" ") || v("company") || v("email") || v("phone");
  const lines = ["BEGIN:VCARD", `VERSION:${VCARD_VERSION}`, `N:${vText(last)};${vText(first)};;;`, `FN:${vText(fullName)}`];
  if (v("company")) lines.push(`ORG:${vText(v("company"))}`);
  if (v("title")) lines.push(`TITLE:${vText(v("title"))}`);
  if (v("phone")) lines.push(`TEL;TYPE=CELL:${vLine(v("phone"))}`);
  if (v("email")) lines.push(`EMAIL;TYPE=INTERNET:${vText(v("email"))}`);
  if (v("website")) lines.push(`URL:${vLine(normalizeUrl(v("website")))}`);
  lines.push("END:VCARD");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function encodePayload(content: QrContent): string {
  switch (content.type) {
    case "website":
      return normalizeUrl(content.url);
    case "text":
      return content.text;
    case "wifi": {
      const pass = content.security === "nopass" ? "" : `P:${wifiEscape(content.password ?? "")};`;
      return `WIFI:T:${content.security};S:${wifiEscape(content.ssid)};${pass}${content.hidden ? "H:true;" : ""};`;
    }
    case "contact":
      return encodeVCard(content);
    case "email": {
      const params = new URLSearchParams();
      if (content.subject) params.set("subject", content.subject);
      if (content.body) params.set("body", content.body);
      const query = params.toString().replace(/\+/g, "%20");
      return `mailto:${content.to}${query ? `?${query}` : ""}`;
    }
    case "phone":
      return `tel:${digits(content.number)}`;
    case "sms":
      return `SMSTO:${digits(content.number)}:${content.message ?? ""}`;
    case "location":
      return `geo:0,0?q=${encodeURIComponent(content.address)}`;
    case "event":
      return [
        "BEGIN:VEVENT",
        `SUMMARY:${content.title}`,
        ...icsEventDates(content.start, content.end),
        content.place ? `LOCATION:${content.place}` : null,
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\n");
  }
}
