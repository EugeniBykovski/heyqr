import { parseWebsiteUrl, type QrContent, type QrContentType } from "@heyqr/qr-core";
import { z } from "zod";

/*
 * Hosted QR pages (design 10.x / 11.x, developer handoff "Types 4.0"): seven types whose code opens a HeyQR-hosted
 * page at the code's permanent Dynamic short link instead of encoding the content itself. They are always Dynamic.
 *
 * The content is versioned JSON (`v`). The saved code's `content` holds the owner's working draft; publishing
 * snapshots a validated copy as an immutable version, and the public page only ever shows the latest published one.
 * Images are data URLs while a draft is unsaved (the editor resizes them first) and `asset:<id>` once stored in the
 * account's private storage; the PDF is always uploaded first, so it is an `asset:<id>` reference.
 *
 * These rules are shared by the editor (feedback) and the server (authority): the server repeats every one.
 */
export const HOSTED_TYPES = ["menu", "coupon", "social", "business", "apps", "pdf", "product"] as const;
export type HostedType = (typeof HOSTED_TYPES)[number];
/** Every type the editor offers: the nine direct types (encoded in the code) and the seven hosted pages. */
export type QrType = QrContentType | HostedType;

export const HOSTED_CONTENT_VERSION = 1 as const;
export const HOSTED_CURRENCIES = ["USD", "EUR", "GBP", "PLN"] as const;
export type HostedCurrency = (typeof HOSTED_CURRENCIES)[number];
export const PRODUCT_CTAS = ["buy", "view", "order"] as const;
export type ProductCta = (typeof PRODUCT_CTAS)[number];
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Limits from the handoff (section 2) plus sane caps on list sizes. */
export const HOSTED_LIMITS = {
  name: 80,
  short: 160,
  note: 200,
  desc: 500,
  terms: 400,
  bio: 160,
  businessDesc: 200,
  appDesc: 200,
  productDesc: 500,
  code: 32,
  price: 12,
  url: 2048,
  sections: 30,
  dishes: 60,
  links: 20,
  productImages: 5,
  imageBytes: 5 * 1024 * 1024,
  pdfBytes: 25 * 1024 * 1024,
  pdfPages: 300,
} as const;

/** A data URL (unsaved draft) or `asset:<id>` (stored in the owner's private storage). */
export type HostedImage = string;

export type MenuDish = { id: string; name: string; desc: string; price: string; photo: HostedImage | null };
export type MenuSection = { id: string; name: string; dishes: MenuDish[] };
export type MenuContent = { type: "menu"; v: 1; name: string; note: string; currency: HostedCurrency; sections: MenuSection[] };

export type CouponContent = {
  type: "coupon";
  v: 1;
  title: string;
  discount: string;
  /** Upper case, no spaces; optional. */
  code: string;
  /** YYYY-MM-DD, the last day the offer is valid, in `timeZone`; "" = no end date. */
  expires: string;
  terms: string;
  link: string;
  /** The owner's time zone (IANA), for the end date. */
  timeZone: string;
};

export type SocialLink = { id: string; label: string; url: string };
export type SocialContent = { type: "social"; v: 1; name: string; bio: string; photo: HostedImage | null; links: SocialLink[] };

export type BusinessDay = { open: boolean; from: string; to: string };
export type BusinessContent = {
  type: "business";
  v: 1;
  name: string;
  desc: string;
  /** Monday first, seven days. */
  hours: BusinessDay[];
  address: string;
  phone: string;
  website: string;
  /** The owner's time zone (IANA), for "Open today". */
  timeZone: string;
};

export type AppsContent = { type: "apps"; v: 1; name: string; desc: string; icon: HostedImage | null; ios: string; android: string };

export type PdfFile = { asset: string; name: string; bytes: number; pages: number | null };
export type PdfContent = { type: "pdf"; v: 1; title: string; desc: string; file: PdfFile | null };

export type ProductContent = {
  type: "product";
  v: 1;
  name: string;
  desc: string;
  price: string;
  currency: HostedCurrency;
  link: string;
  cta: ProductCta;
  /** Up to 5; the first is the cover. */
  images: HostedImage[];
};

export type HostedContent = MenuContent | CouponContent | SocialContent | BusinessContent | AppsContent | PdfContent | ProductContent;
/** What a saved code or an editor draft holds: direct content (encoded in the code) or a hosted page. */
export type AnyQrContent = QrContent | HostedContent;

export const isHostedType = (type: string): type is HostedType => (HOSTED_TYPES as readonly string[]).includes(type);
export const isHostedContent = (content: AnyQrContent): content is HostedContent => isHostedType(content.type);

let seq = 0;
/** A short local id for list items (sections, dishes, links); stable across edits so React keys and moves work. */
export const itemId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const newItemId = itemId;

const zoneHere = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function blankHours(): BusinessDay[] {
  return WEEKDAYS.map((_, i) => ({ open: i < 5, from: "09:00", to: "17:00" }));
}

/** An empty form of the type (the editor's starting point and "Clear"). */
export function emptyHostedContent(type: HostedType): HostedContent {
  const defaultTimeZone = zoneHere;
  switch (type) {
    case "menu":
      return {
        type,
        v: 1,
        name: "",
        note: "",
        currency: "USD",
        sections: [{ id: itemId(), name: "", dishes: [{ id: itemId(), name: "", desc: "", price: "", photo: null }] }],
      };
    case "coupon":
      return { type, v: 1, title: "", discount: "", code: "", expires: "", terms: "", link: "", timeZone: defaultTimeZone() };
    case "social":
      return { type, v: 1, name: "", bio: "", photo: null, links: [{ id: itemId(), label: "", url: "" }] };
    case "business":
      return { type, v: 1, name: "", desc: "", hours: blankHours(), address: "", phone: "", website: "", timeZone: defaultTimeZone() };
    case "apps":
      return { type, v: 1, name: "", desc: "", icon: null, ios: "", android: "" };
    case "pdf":
      return { type, v: 1, title: "", desc: "", file: null };
    case "product":
      return { type, v: 1, name: "", desc: "", price: "", currency: "USD", link: "", cta: "view", images: [] };
  }
}

/** The design's example content ("Start from the example"). Images are left out: they are the owner's to add. */
export function sampleHostedContent(type: HostedType, opts: { id?: () => string; timeZone?: string } = {}): HostedContent {
  // Server-rendered previews (home Explore) pass stable ids and a fixed zone so server and browser render the same.
  const itemId = opts.id ?? newItemId;
  const defaultTimeZone = () => opts.timeZone ?? zoneHere();
  const dish = (name: string, desc: string, price: string): MenuDish => ({ id: itemId(), name, desc, price, photo: null });
  switch (type) {
    case "menu":
      return {
        type,
        v: 1,
        name: "Little Fern Café",
        note: "Kitchen open 8:00–15:00 · (v) vegan",
        currency: "USD",
        sections: [
          {
            id: itemId(),
            name: "Breakfast",
            dishes: [
              dish("Fern toast", "Sourdough, smashed peas, lemon, chili", "11"),
              dish("Overnight oats (v)", "Oat milk, roasted pear, toasted seeds", "9"),
            ],
          },
          {
            id: itemId(),
            name: "Coffee",
            dishes: [dish("Flat white", "Double shot, whole or oat milk", "4.50"), dish("Cold brew", "Steeped for 18 hours", "5")],
          },
          { id: itemId(), name: "Sweets", dishes: [dish("Cardamom bun", "Baked every morning", "4")] },
        ],
      };
    case "coupon": {
      const next = new Date();
      next.setUTCMonth(next.getUTCMonth() + 1, 0);
      return {
        type,
        v: 1,
        title: "On any pottery class booked this month",
        discount: "20% off",
        code: "FERN20",
        expires: next.toISOString().slice(0, 10),
        terms:
          "One code per person. Can’t be combined with other offers. Show this screen at the studio or enter the code when you book online.",
        link: "reyes.studio/classes",
        timeZone: defaultTimeZone(),
      };
    }
    case "social":
      return {
        type,
        v: 1,
        name: "Ana Reyes",
        bio: "Product designer in San Francisco. Ceramics on weekends.",
        photo: null,
        links: [
          { id: itemId(), label: "Portfolio", url: "anareyes.studio" },
          { id: itemId(), label: "Instagram · @ana.makes", url: "instagram.com/ana.makes" },
          { id: itemId(), label: "YouTube · studio diaries", url: "youtube.com/@anareyes" },
          { id: itemId(), label: "LinkedIn", url: "linkedin.com/in/anareyes" },
        ],
      };
    case "business":
      return {
        type,
        v: 1,
        name: "Reyes Ceramics Studio",
        desc: "Hand-thrown tableware and weekend pottery classes.",
        hours: [
          { open: false, from: "10:00", to: "18:00" },
          { open: true, from: "10:00", to: "18:00" },
          { open: true, from: "10:00", to: "18:00" },
          { open: true, from: "10:00", to: "20:00" },
          { open: true, from: "10:00", to: "18:00" },
          { open: true, from: "09:00", to: "16:00" },
          { open: false, from: "10:00", to: "16:00" },
        ],
        address: "21 Pier St, San Francisco",
        phone: "+1 415 555 0142",
        website: "reyes.studio",
        timeZone: defaultTimeZone(),
      };
    case "apps":
      return {
        type,
        v: 1,
        name: "Fern Rewards",
        desc: "Collect a stamp with every coffee. The tenth one is on us.",
        icon: null,
        ios: "apps.apple.com/app/fern-rewards",
        android: "play.google.com/store/apps/details?id=cafe.fern.rewards",
      };
    case "pdf":
      return { type, v: 1, title: "Spring class schedule", desc: "Dates, prices and what to bring.", file: null };
    case "product":
      return {
        type,
        v: 1,
        name: "Speckled stoneware mug",
        desc: "Wheel-thrown, 350 ml, dishwasher safe. Every glaze turns out a little different.",
        price: "38",
        currency: "USD",
        link: "reyes.studio/shop/speckled-mug",
        cta: "buy",
        images: [],
      };
  }
}

/** True when the form still has nothing typed (the editor then offers "Start from the example"). */
export function isHostedEmpty(content: HostedContent): boolean {
  const blank = emptyHostedContent(content.type);
  const strip = (c: HostedContent) => JSON.stringify(c, (k, v: unknown) => (k === "id" || k === "timeZone" ? undefined : v));
  return strip(content) === strip(blank);
}

/* ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** Field path (e.g. `sections.0.dishes.1.price`) → message key under `editor.hosted.errors`. Order follows the form. */
export type HostedErrors = Record<string, string>;

const PRICE = /^\d{1,7}([.,]\d{1,2})?$/;
const PHONE = /^[+()\d\s.-]{6,}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9_-]+$/;
const blank = (s: string | undefined) => !(s ?? "").trim();
const webUrl = (s: string) => parseWebsiteUrl(s).ok;

/** Normalizes a promo code as the owner types it: upper case, no spaces. */
export const normalizePromoCode = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** A store link: an App Store link must be on apps.apple.com, a Google Play link on play.google.com. */
export function storeLinkOk(store: "ios" | "android", value: string): boolean {
  const parsed = parseWebsiteUrl(value);
  if (!parsed.ok) return false;
  const host = new URL(parsed.url).hostname.toLowerCase();
  return store === "ios" ? host === "apps.apple.com" : host === "play.google.com";
}

/** Today's date (YYYY-MM-DD) in a time zone; falls back to UTC for an unknown zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The coupon end-date rule: "Ends on <date>" means the offer is valid through the whole of that day in the owner's
 * time zone and expires at the next local midnight. No end date: it never expires.
 */
export const couponExpired = (c: CouponContent, now: Date = new Date()) => Boolean(c.expires) && c.expires < todayIn(c.timeZone, now);

/**
 * The handoff's rules for publishing (and Continue in the editor). Each error is a path and a message key.
 * `now` lets the server and tests fix the date for "This date has passed".
 */
export function hostedErrors(content: HostedContent, now: Date = new Date()): HostedErrors {
  const e: HostedErrors = {};
  switch (content.type) {
    case "menu": {
      if (blank(content.name)) e.name = "menuName";
      if (content.sections.length === 0) e.sections = "menuSections";
      content.sections.forEach((s, i) => {
        if (blank(s.name)) e[`sections.${i}.name`] = "sectionName";
        if (s.dishes.length === 0) e[`sections.${i}.dishes`] = "sectionDishes";
        s.dishes.forEach((d, j) => {
          if (blank(d.name)) e[`sections.${i}.dishes.${j}.name`] = "dishName";
          if (!blank(d.price) && !PRICE.test(d.price.trim())) e[`sections.${i}.dishes.${j}.price`] = "price";
        });
      });
      break;
    }
    case "coupon":
      if (blank(content.title)) e.title = "couponTitle";
      if (blank(content.discount)) e.discount = "couponDiscount";
      if (!blank(content.code) && !CODE.test(content.code)) e.code = "couponCode";
      if (content.expires) {
        if (!DATE.test(content.expires) || Number.isNaN(Date.parse(content.expires))) e.expires = "dateInvalid";
        else if (couponExpired(content, now)) e.expires = "datePassed";
      }
      if (!blank(content.link) && !webUrl(content.link))
        e.link = parseWebsiteUrl(content.link).ok ? "urlInvalid" : websiteProblem(content.link);
      break;
    case "social":
      if (blank(content.name)) e.name = "socialName";
      if (content.links.length === 0) e.links = "socialLinks";
      content.links.forEach((l, i) => {
        if (blank(l.label)) e[`links.${i}.label`] = "linkLabel";
        if (!webUrl(l.url)) e[`links.${i}.url`] = "linkUrl";
      });
      break;
    case "business":
      if (blank(content.name)) e.name = "businessName";
      if (blank(content.address) && blank(content.phone) && blank(content.website)) e.address = "businessReach";
      if (!blank(content.phone) && !PHONE.test(content.phone)) e.phone = "phone";
      if (!blank(content.website) && !webUrl(content.website)) e.website = websiteProblem(content.website);
      content.hours.forEach((h, i) => {
        if (!h.open) return;
        if (!TIME.test(h.from) || !TIME.test(h.to)) e[`hours.${i}`] = "hoursInvalid";
        else if (h.to <= h.from) e[`hours.${i}`] = "hoursOrder";
      });
      break;
    case "apps":
      if (blank(content.name)) e.name = "appName";
      if (blank(content.ios) && blank(content.android)) e.ios = "appStores";
      if (!blank(content.ios) && !storeLinkOk("ios", content.ios)) e.ios = "appStoreLink";
      if (!blank(content.android) && !storeLinkOk("android", content.android)) e.android = "googlePlayLink";
      break;
    case "pdf":
      if (blank(content.title)) e.title = "pdfTitle";
      if (!content.file) e.file = "pdfFile";
      break;
    case "product":
      if (blank(content.name)) e.name = "productName";
      if (blank(content.link)) e.link = "productLink";
      else if (!webUrl(content.link)) e.link = websiteProblem(content.link);
      if (!blank(content.price) && !PRICE.test(content.price.trim())) e.price = "productPrice";
      if (content.images.length > HOSTED_LIMITS.productImages) e.images = "productImages";
      break;
  }
  return e;
}

function websiteProblem(raw: string): string {
  const parsed = parseWebsiteUrl(raw);
  if (parsed.ok) return "urlInvalid";
  return parsed.problem === "spaces" ? "urlSpaces" : parsed.problem === "empty" ? "urlEmpty" : "urlInvalid";
}

/** A web address as the public page links it (https:// added to a bare domain), or null. */
export function hostedHref(raw: string): string | null {
  const parsed = parseWebsiteUrl(raw);
  return parsed.ok ? parsed.url : null;
}

/** A price as shown on the public page, in the content's currency (e.g. "$4.50", "12,00 zł"). */
export function formatHostedPrice(price: string, currency: HostedCurrency, locale = "en"): string {
  const n = Number(price.trim().replace(",", "."));
  if (!price.trim() || Number.isNaN(n)) return "";
  try {
    // Always the currency's minor units, so a menu lists $11.00 beside $4.50 (design 10.x / 11.0).
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

/** Every stored or draft image the content refers to (for storage, cleanup and public reads). */
export function hostedImages(content: HostedContent): HostedImage[] {
  switch (content.type) {
    case "menu":
      return content.sections.flatMap((s) => s.dishes.map((d) => d.photo)).filter((p): p is string => Boolean(p));
    case "social":
      return content.photo ? [content.photo] : [];
    case "apps":
      return content.icon ? [content.icon] : [];
    case "product":
      return content.images;
    default:
      return [];
  }
}

/** The `asset:<id>` ids the content refers to: its images and its PDF. */
export function hostedAssetIds(content: HostedContent): string[] {
  const refs = hostedImages(content).flatMap((h) => (h.startsWith("asset:") ? [h.slice(6)] : []));
  if (content.type === "pdf" && content.file?.asset.startsWith("asset:")) refs.push(content.file.asset.slice(6));
  return [...new Set(refs)];
}

/* ── Shape (the server's schema for a stored draft) ─────────────────────────────────────────────────────────── */

const str = (max: number) => z.string().max(max);
const image = z
  .string()
  .max(8_000_000)
  // Photos are JPG or PNG (design 11.14); stored ones are `asset:<id>` references.
  .refine((s) => /^asset:[A-Za-z0-9_-]{6,64}$/.test(s) || /^data:image\/(png|jpeg);base64,/.test(s), "image");
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const currency = z.enum(HOSTED_CURRENCIES);
const tz = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_+\-/]+$/);

/**
 * The stored shape of every hosted type (strict: unknown fields are refused). It allows an unfinished draft (empty
 * strings, no file yet); `hostedErrors` decides whether it can be published.
 */
export const hostedContentSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("menu"),
    v: z.literal(1),
    name: str(HOSTED_LIMITS.name),
    note: str(HOSTED_LIMITS.note),
    currency,
    sections: z
      .array(
        z.strictObject({
          id,
          name: str(HOSTED_LIMITS.name),
          dishes: z
            .array(
              z.strictObject({
                id,
                name: str(HOSTED_LIMITS.name),
                desc: str(HOSTED_LIMITS.note),
                price: str(HOSTED_LIMITS.price),
                photo: image.nullable(),
              }),
            )
            .max(HOSTED_LIMITS.dishes),
        }),
      )
      .max(HOSTED_LIMITS.sections),
  }),
  z.strictObject({
    type: z.literal("coupon"),
    v: z.literal(1),
    title: str(HOSTED_LIMITS.short),
    discount: str(HOSTED_LIMITS.name),
    code: str(HOSTED_LIMITS.code),
    expires: z.union([z.literal(""), z.string().regex(DATE)]),
    terms: str(HOSTED_LIMITS.terms),
    link: str(HOSTED_LIMITS.url),
    timeZone: tz,
  }),
  z.strictObject({
    type: z.literal("social"),
    v: z.literal(1),
    name: str(HOSTED_LIMITS.name),
    bio: str(HOSTED_LIMITS.bio),
    photo: image.nullable(),
    links: z.array(z.strictObject({ id, label: str(HOSTED_LIMITS.name), url: str(HOSTED_LIMITS.url) })).max(HOSTED_LIMITS.links),
  }),
  z.strictObject({
    type: z.literal("business"),
    v: z.literal(1),
    name: str(HOSTED_LIMITS.name),
    desc: str(HOSTED_LIMITS.businessDesc),
    hours: z.array(z.strictObject({ open: z.boolean(), from: str(5), to: str(5) })).length(7),
    address: str(HOSTED_LIMITS.short),
    phone: str(40),
    website: str(HOSTED_LIMITS.url),
    timeZone: tz,
  }),
  z.strictObject({
    type: z.literal("apps"),
    v: z.literal(1),
    name: str(HOSTED_LIMITS.name),
    desc: str(HOSTED_LIMITS.appDesc),
    icon: image.nullable(),
    ios: str(HOSTED_LIMITS.url),
    android: str(HOSTED_LIMITS.url),
  }),
  z.strictObject({
    type: z.literal("pdf"),
    v: z.literal(1),
    title: str(HOSTED_LIMITS.name),
    desc: str(HOSTED_LIMITS.note),
    file: z
      .strictObject({
        asset: z.string().regex(/^asset:[A-Za-z0-9_-]{6,64}$/),
        name: str(200),
        bytes: z.number().int().positive().max(HOSTED_LIMITS.pdfBytes),
        pages: z.number().int().positive().max(HOSTED_LIMITS.pdfPages).nullable(),
      })
      .nullable(),
  }),
  z.strictObject({
    type: z.literal("product"),
    v: z.literal(1),
    name: str(HOSTED_LIMITS.name),
    desc: str(HOSTED_LIMITS.productDesc),
    price: str(HOSTED_LIMITS.price),
    currency,
    link: str(HOSTED_LIMITS.url),
    cta: z.enum(PRODUCT_CTAS),
    images: z.array(image).max(HOSTED_LIMITS.productImages),
  }),
]);

/** Reads stored or submitted hosted content; null when it doesn't match the shape. */
export function readHostedContent(raw: unknown): HostedContent | null {
  const parsed = hostedContentSchema.safeParse(raw);
  return parsed.success ? (parsed.data as HostedContent) : null;
}

/* ── Business hours ─────────────────────────────────────────────────────────────────────────────────────────── */

export type BusinessNow = { kind: "open"; to: string } | { kind: "before"; from: string } | { kind: "after" } | { kind: "closedToday" };

/** The weekday (0 = Monday) and wall time ("HH:MM") at `now` in a time zone (UTC for an unknown zone). */
export function wallClock(timeZone: string, now: Date = new Date()): { day: number; time: string } {
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
    return { day: Math.max(0, day), time: `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}` };
  };
  try {
    return read(timeZone);
  } catch {
    return read("UTC");
  }
}

/** Design 11.6 "Open now · until 18:00": today's row and status in the business's own time zone. */
export function businessNow(content: BusinessContent, now: Date = new Date()): { day: number; status: BusinessNow } {
  const { day, time } = wallClock(content.timeZone, now);
  const h = content.hours[day];
  if (!h?.open) return { day, status: { kind: "closedToday" } };
  if (time < h.from) return { day, status: { kind: "before", from: h.from } };
  if (time < h.to) return { day, status: { kind: "open", to: h.to } };
  return { day, status: { kind: "after" } };
}

/** A file size as people read it: "820 KB", "3.4 MB". */
export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round(mb * 10) / 10} MB`;
}

/** Where a stored or draft image is shown: data URLs as-is, the owner's stored files through the owner-only route. */
export function hostedImageSrc(ref: string): string {
  if (ref.startsWith("asset:")) return `/api/hosted/assets/${ref.slice(6)}`;
  return ref;
}
