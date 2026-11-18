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
    case "contact": {
      const note = [content.title, content.company].filter(Boolean).join(", ");
      return (
        `MECARD:N:${content.lastName ?? ""},${content.firstName ?? ""};` +
        (content.phone ? `TEL:${digits(content.phone)};` : "") +
        (content.email ? `EMAIL:${content.email};` : "") +
        (content.website ? `URL:${content.website};` : "") +
        (note ? `NOTE:${note};` : "") +
        ";"
      );
    }
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
        `DTSTART:${icsDate(content.start)}`,
        `DTEND:${icsDate(content.end ?? content.start)}`,
        content.place ? `LOCATION:${content.place}` : null,
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\n");
  }
}
