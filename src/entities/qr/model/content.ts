import type { QrContent, QrContentType } from "@heyqr/qr-core";

export type ContentField = {
  name: string;
  /** Message key in `fields`. */
  label: string;
  kind: "text" | "url" | "tel" | "email" | "textarea" | "datetime-local" | "date" | "time" | "security" | "checkbox";
  required?: boolean;
  /** Not required, but not labelled "optional" either (design 1.3: name, phone and email carry no marker). */
  unmarked?: boolean;
  /** Half width beside its neighbour from 600 px (design "pair"); other fields of these types are full width. */
  half?: boolean;
  /** Suggested value shown while empty. */
  placeholder?: string;
  autoComplete?: string;
};

/** Design 1.5: a text code holds at most this many characters (the hint counts them). */
export const TEXT_MAX_CHARS = 300;

/** Form definition per content type. Validation here is UX only; payload encoding lives in qr-core. */
export const CONTENT_FIELDS: Record<QrContentType, ContentField[]> = {
  website: [{ name: "url", label: "url", kind: "url", required: true, autoComplete: "url" }],
  text: [{ name: "text", label: "text", kind: "textarea", required: true }],
  wifi: [
    { name: "ssid", label: "ssid", kind: "text", required: true },
    { name: "security", label: "security", kind: "security" },
    { name: "password", label: "password", kind: "text" },
    { name: "hidden", label: "hidden", kind: "checkbox" },
  ],
  contact: [
    // Design 1.3 Content · contact card: first | last, job title | company, then phone, email, website.
    { name: "firstName", label: "firstName", kind: "text", unmarked: true, half: true, autoComplete: "given-name" },
    { name: "lastName", label: "lastName", kind: "text", unmarked: true, half: true, autoComplete: "family-name" },
    { name: "title", label: "title", kind: "text", half: true, autoComplete: "organization-title" },
    { name: "company", label: "company", kind: "text", half: true, autoComplete: "organization" },
    { name: "phone", label: "phone", kind: "tel", unmarked: true, placeholder: "+1 415 555 0142", autoComplete: "tel" },
    { name: "email", label: "email", kind: "email", unmarked: true, placeholder: "you@studio.com", autoComplete: "email" },
    { name: "website", label: "website", kind: "url", placeholder: "yourname.com", autoComplete: "url" },
  ],
  email: [
    { name: "to", label: "to", kind: "email", required: true, autoComplete: "email" },
    { name: "subject", label: "subject", kind: "text" },
    { name: "body", label: "body", kind: "textarea" },
  ],
  phone: [{ name: "number", label: "number", kind: "tel", required: true, autoComplete: "tel" }],
  sms: [
    { name: "number", label: "number", kind: "tel", required: true, autoComplete: "tel" },
    { name: "message", label: "message", kind: "textarea" },
  ],
  location: [
    { name: "name", label: "name", kind: "text" },
    { name: "address", label: "address", kind: "text", required: true, autoComplete: "street-address" },
  ],
  event: [
    { name: "title", label: "eventTitle", kind: "text", required: true },
    // Design 1.14: one date, then start and end times. They are stored as the event's start / end ("YYYY-MM-DD" for an
    // all-day event, "YYYY-MM-DDTHH:mm" with a time); startTime and endTime are views of those, not content keys.
    { name: "start", label: "date", kind: "date", required: true, half: true },
    { name: "startTime", label: "start", kind: "time", unmarked: true },
    { name: "endTime", label: "end", kind: "time", unmarked: true },
    { name: "place", label: "place", kind: "text" },
  ],
};

export function emptyContent(type: QrContentType): QrContent {
  switch (type) {
    case "website":
      return { type, url: "" };
    case "text":
      return { type, text: "" };
    case "wifi":
      return { type, ssid: "", security: "WPA", password: "" };
    case "contact":
      return { type };
    case "email":
      return { type, to: "" };
    case "phone":
      return { type, number: "" };
    case "sms":
      return { type, number: "" };
    case "location":
      return { type, address: "" };
    case "event":
      return { type, title: "", start: "" };
  }
}

/** True when every required field has a value (so the preview encodes real content). */
export function isContentComplete(content: QrContent): boolean {
  const record = content as Record<string, unknown>;
  return CONTENT_FIELDS[content.type].every(
    (f) => !f.required || (typeof record[f.name] === "string" && (record[f.name] as string).trim() !== ""),
  );
}

/**
 * Design displayName / cpSummary (HEY-64): how a code is called when it has no name of its own — the site's host for a
 * website ("littlefern.cafe/menu" → "littlefern.cafe"), the first line of a text, the network, person, address or
 * event. Null while the content is still empty (callers fall back to their generic placeholder).
 */
export function contentDisplayName(content: QrContent): string | null {
  const clip = (s: string | undefined) => {
    const v = (s ?? "").split("\n")[0]?.trim() ?? "";
    return v ? (v.length > 40 ? `${v.slice(0, 39)}…` : v) : null;
  };
  switch (content.type) {
    case "website": {
      const host = content.url
        .trim()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .split(/[/?#]/)[0]
        ?.replace(/^www\./i, "");
      return clip(host);
    }
    case "text":
      return clip(content.text);
    case "wifi":
      return clip(content.ssid);
    case "contact":
      return clip([content.firstName, content.lastName].filter(Boolean).join(" ") || content.company || content.email);
    case "email":
      return clip(content.to);
    case "phone":
    case "sms":
      return clip(content.number);
    case "location":
      return clip(content.name || content.address);
    case "event":
      return clip(content.title);
  }
}
