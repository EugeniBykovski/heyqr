import type { QrContent } from "@heyqr/qr-core";
import type { EditorDesign } from "./design";

/**
 * Home "Examples" rail (design: homeShowcase). Each example is a complete starting design the editor can open.
 * The design shows some of them as card layouts (business card, table tent, poster); the editor's presets are
 * code / caption / frame, so those open as the closest caption layout with the same colours and shapes.
 * Colours are customer QR data, not UI tokens.
 */
export type QrExample = {
  id: "businessCard" | "tableTent" | "menuSticker" | "eventPoster" | "contactBadge" | "windowSticker";
  model: "static" | "dynamic";
  content: QrContent;
  design: Partial<EditorDesign>;
};

export const QR_EXAMPLES: readonly QrExample[] = [
  {
    id: "businessCard",
    model: "static",
    content: { type: "website", url: "https://anareyes.studio/portfolio" },
    design: { preset: "caption", caption: "View portfolio" },
  },
  {
    id: "tableTent",
    model: "static",
    content: { type: "wifi", ssid: "Little Fern Guest", security: "WPA", password: "fern-latte-7" },
    design: {
      fg: "#1F5C45",
      bg: "#EEF6F0",
      pattern: "dot",
      eyeFrame: "circle",
      eyeBall: "circle",
      preset: "caption",
      caption: "Scan to join",
    },
  },
  {
    id: "menuSticker",
    model: "dynamic",
    content: { type: "website", url: "https://littlefern.cafe/menu" },
    design: {
      fg: "#8C2F4B",
      pattern: "rounded",
      eyeFrame: "cushion",
      eyeBall: "rounded",
      preset: "frame",
      frameStyle: "bubble",
      caption: "See the menu",
    },
  },
  {
    id: "eventPoster",
    model: "dynamic",
    // Dynamic codes redirect to a web address, so the poster links to the event page (see model/modes.ts).
    content: { type: "website", url: "https://reyes.studio/spring-show" },
    design: { fg: "#1F4E8C", bg: "#EEF3FA", pattern: "fluid", preset: "caption", caption: "RSVP inside" },
  },
  {
    id: "contactBadge",
    model: "static",
    content: { type: "contact", firstName: "Ana", lastName: "Reyes", phone: "+14155550142", email: "ana@anareyes.studio" },
    design: {
      fg: "#4B2EE0",
      pattern: "leaf",
      eyeFrame: "leaf",
      eyeBall: "leaf",
      preset: "frame",
      frameStyle: "circle",
      caption: "Save my contact",
    },
  },
  {
    id: "windowSticker",
    model: "static",
    content: { type: "website", url: "https://reyes.studio/shop" },
    design: {
      fg: "#9A4A22",
      pattern: "diamond",
      eyeFrame: "rounded",
      eyeBall: "diamond",
      preset: "frame",
      frameStyle: "ticket",
      caption: "Open today",
    },
  },
];
