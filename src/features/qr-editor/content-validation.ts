import { parseWebsiteUrl, type QrContent } from "@heyqr/qr-core";

/**
 * Content step validation (design: contentErrors). Keys are the content field names (inputs have id `content-<name>`),
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

export function contentErrors(content: QrContent): ContentErrors {
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
    case "event":
      if (!text("title").trim()) e.title = "eventTitle";
      if (!text("start")) e.start = "eventStart";
      break;
  }
  return e;
}
