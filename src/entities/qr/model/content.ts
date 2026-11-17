import type { QrContent, QrContentType } from "@heyqr/qr-core";

export type ContentField = {
  name: string;
  /** Message key in `fields`. */
  label: string;
  kind: "text" | "url" | "tel" | "email" | "textarea" | "datetime-local" | "security" | "checkbox";
  required?: boolean;
  autoComplete?: string;
};

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
    { name: "firstName", label: "firstName", kind: "text", autoComplete: "given-name" },
    { name: "lastName", label: "lastName", kind: "text", autoComplete: "family-name" },
    { name: "phone", label: "phone", kind: "tel", autoComplete: "tel" },
    { name: "email", label: "email", kind: "email", autoComplete: "email" },
    { name: "company", label: "company", kind: "text", autoComplete: "organization" },
    { name: "title", label: "title", kind: "text", autoComplete: "organization-title" },
    { name: "website", label: "website", kind: "url", autoComplete: "url" },
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
    { name: "start", label: "start", kind: "datetime-local", required: true },
    { name: "end", label: "end", kind: "datetime-local" },
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
