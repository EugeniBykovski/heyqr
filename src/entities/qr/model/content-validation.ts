import { parseWebsiteUrl } from "@heyqr/qr-core";
import { hostedErrors, isHostedContent, type AnyQrContent } from "./hosted";

/**
 * Content step validation (design: contentErrors), shared by the editor and the public API (HEY-155). Keys are the content field names (inputs have id `content-<name>`),
 * values are message keys under `editor.errors`. Order follows the form, so the first key is the field to focus.
 */
export type ContentErrors = Record<string, string>;

const PHONE = /^[+()\d\s.-]{6,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const URL_ERRORS = { empty: "urlEmpty", spaces: "urlSpaces", invalid: "urlInvalid" } as const;

/** A web address people can open, checked by the same parser the QR encoding relies on (qr-core parseWebsiteUrl). */
export function urlProblem(raw: string): "urlEmpty" | "urlSpaces" | "urlInvalid" | null {
  const parsed = parseWebsiteUrl(raw);
  return parsed.ok ? null : URL_ERRORS[parsed.problem];
}

export function contentErrors(content: AnyQrContent): ContentErrors {
  // Hosted pages: the shared publishing rules (keys are field paths, values message keys under editor.hosted.errors).
  if (isHostedContent(content)) return hostedErrors(content);
  const c = content as Record<string, string | boolean | undefined>;
  const text = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  const e: ContentErrors = {};
  switch (content.type) {
    case "website": {
      const p = urlProblem(text("url"));
      if (p) e.url = p;
      break;
    }
    case "text":
      if (!text("text").trim()) e.text = "text";
      break;
    case "wifi":
      if (!text("ssid").trim()) e.ssid = "ssid";
      if (c.security !== "nopass") {
        if (!text("password")) e.password = "password";
        else if (c.security === "WPA" && text("password").length < 8) e.password = "passwordShort";
      }
      break;
    case "contact":
      if (!text("firstName").trim() && !text("lastName").trim()) e.firstName = "contactName";
      if (text("phone") && !PHONE.test(text("phone"))) e.phone = "phone";
      if (text("email") && !EMAIL.test(text("email"))) e.email = "email";
      // Optional, but when given it must be an address phones can open (same rules as a Website code).
      if (text("website").trim()) {
        const p = urlProblem(text("website"));
        if (p) e.website = p;
      }
      break;
    case "email":
      if (!EMAIL.test(text("to"))) e.to = text("to") ? "emailInvalid" : "emailTo";
      break;
    case "phone":
      if (!PHONE.test(text("number"))) e.number = "phoneNumber";
      break;
    case "sms":
      if (!PHONE.test(text("number"))) e.number = "smsTo";
      break;
    case "location":
      if (!text("address").trim()) e.address = "address";
      break;
    case "event": {
      if (!text("title").trim()) e.title = "eventTitle";
      const problem = eventTimeProblem(text("start"), text("end") || undefined);
      if (problem === "eventStart" || problem === "eventDateInvalid") e.start = problem;
      else if (problem) e.endTime = problem;
      break;
    }
  }
  return e;
}

/** "2026-12-05" or "2026-12-05T19:00", and a real calendar day (not 2026-02-30). */
function eventMoment(value: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map((x) => (x === undefined ? undefined : Number(x)));
  const day = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() + 1 !== mo || day.getUTCDate() !== d) return null;
  if (h !== undefined && (h > 23 || (mi ?? 0) > 59)) return null;
  return { date: value.slice(0, 10), time: h === undefined ? null : value.slice(11, 16) };
}

/**
 * Design 1.14 / HEY-193: an event's date and times. Required: a real date. Optional: a start time, and an end time
 * that needs a start time and comes after it on the same day (the form has one date, so an event can't run past
 * midnight). Times are floating local times: a 19:00 event is 19:00 wherever the code is scanned.
 */
export function eventTimeProblem(
  start: string,
  end?: string,
): "eventStart" | "eventDateInvalid" | "eventEndInvalid" | "eventEndNeedsStart" | "eventEnd" | null {
  if (!start.trim()) return "eventStart";
  const s = eventMoment(start.trim());
  if (!s) return "eventDateInvalid";
  if (end === undefined || !end.trim()) return null;
  const e = eventMoment(end.trim());
  if (!e) return "eventEndInvalid";
  if (e.time && !s.time) return "eventEndNeedsStart";
  // A date-only end is an all-day event's last day (the encoder ends it the next day): it may equal the start.
  if (!e.time) return e.date >= s.date ? null : "eventEnd";
  return `${e.date}T${e.time}` > `${s.date}T${s.time ?? ""}` ? null : "eventEnd";
}

/**
 * What a saved draft may hold for an event (HEY-193): unfinished is fine (no title or date yet), but a date or time
 * that is there has to be one the encoder can turn into a correct calendar entry.
 */
export function eventDraftOk(content: AnyQrContent): boolean {
  if (content.type !== "event") return true;
  if (!content.start) return !content.end;
  return eventTimeProblem(content.start, content.end) === null;
}
