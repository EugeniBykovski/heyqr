import { describe, expect, it } from "vitest";
import {
  businessNow,
  couponExpired,
  emptyHostedContent,
  formatHostedPrice,
  HOSTED_TYPES,
  hostedAssetIds,
  hostedErrors,
  isHostedEmpty,
  normalizePromoCode,
  readHostedContent,
  sampleHostedContent,
  storeLinkOk,
  type BusinessContent,
  type CouponContent,
} from "./hosted";
import { MODES_BY_TYPE, modeFor, supportsMode } from "./modes";
import { deviceFromUserAgent, storeRedirect } from "../../../server/qr/hosted-device";

const NOW = new Date("2026-11-25T12:00:00Z");

describe("hosted page rules (shared by the editor and the server)", () => {
  it("every hosted type is Dynamic only; Website keeps Static and Dynamic; other direct types stay Static", () => {
    for (const type of HOSTED_TYPES) {
      expect(MODES_BY_TYPE[type]).toEqual(["dynamic"]);
      expect(supportsMode(type, "static")).toBe(false);
      expect(modeFor(type, "static")).toBe("dynamic");
    }
    expect(MODES_BY_TYPE.website).toEqual(["static", "dynamic"]);
    expect(modeFor("wifi", "dynamic")).toBe("static");
  });

  it("the example content of every type passes the publishing rules; the empty form doesn't", () => {
    for (const type of HOSTED_TYPES) {
      const sample = sampleHostedContent(type);
      const errors = hostedErrors(sample, NOW);
      // The PDF example has no file yet (it must be uploaded).
      expect(errors).toEqual(type === "pdf" ? { file: "pdfFile" } : {});
      expect(Object.keys(hostedErrors(emptyHostedContent(type), NOW)).length).toBeGreaterThan(0);
      expect(isHostedEmpty(emptyHostedContent(type))).toBe(true);
      expect(isHostedEmpty(sample)).toBe(false);
      expect(readHostedContent(sample)).not.toBeNull();
    }
  });

  it("menu: names everywhere, digits-only prices", () => {
    const m = sampleHostedContent("menu");
    if (m.type !== "menu" || !m.sections[0]?.dishes[0]) throw new Error();
    const bad = {
      ...m,
      sections: [{ ...m.sections[0], name: "", dishes: [{ ...m.sections[0].dishes[0], name: "", price: "12 dollars" }] }],
    };
    expect(hostedErrors(bad, NOW)).toEqual({
      "sections.0.name": "sectionName",
      "sections.0.dishes.0.name": "dishName",
      "sections.0.dishes.0.price": "price",
    });
    expect(hostedErrors({ ...m, sections: [] }, NOW)).toEqual({ sections: "menuSections" });
    expect(formatHostedPrice("4.50", "USD")).toBe("$4.50");
    expect(formatHostedPrice("12", "EUR", "de").replace(/\s/g, " ")).toBe("12,00 €");
    expect(formatHostedPrice("11", "USD")).toBe("$11.00");
    expect(formatHostedPrice("", "USD")).toBe("");
  });

  it("coupon: missing discount, past date and a URL with spaces (design 11.3)", () => {
    const c = sampleHostedContent("coupon") as CouponContent;
    expect(hostedErrors({ ...c, discount: "", expires: "2026-11-24", link: "my shop.com/offer" }, NOW)).toEqual({
      discount: "couponDiscount",
      expires: "datePassed",
      link: "urlSpaces",
    });
    // Clearing the end date is allowed: an offer with no end.
    expect(hostedErrors({ ...c, expires: "" }, NOW)).toEqual({});
    expect(normalizePromoCode("fern 20")).toBe("FERN20");
  });

  it("coupon end date: valid through that day in the owner's time zone, expired from the next local midnight", () => {
    const c = { ...(sampleHostedContent("coupon") as CouponContent), expires: "2026-11-30", timeZone: "Europe/Warsaw" };
    expect(couponExpired(c, new Date("2026-11-30T22:59:59Z"))).toBe(false); // 23:59:59 in Warsaw
    expect(couponExpired(c, new Date("2026-11-30T23:00:00Z"))).toBe(true); // 00:00 on Dec 1 in Warsaw
    expect(couponExpired({ ...c, expires: "" }, new Date("2099-01-01"))).toBe(false);
  });

  it("social: row-level errors for a missing label and an invalid URL", () => {
    const s = sampleHostedContent("social");
    if (s.type !== "social") throw new Error();
    const links = [
      { id: "a", label: "", url: "instagram.com/x" },
      { id: "b", label: "Shop", url: "not a url" },
    ];
    expect(hostedErrors({ ...s, links }, NOW)).toEqual({ "links.0.label": "linkLabel", "links.1.url": "linkUrl" });
  });

  it("business: a way to reach you, closing after opening, phone-only is fine", () => {
    const b = sampleHostedContent("business") as BusinessContent;
    expect(hostedErrors({ ...b, address: "", phone: "", website: "" }, NOW)).toEqual({ address: "businessReach" });
    const hours = b.hours.map((h, i) => (i === 1 ? { open: true, from: "18:00", to: "18:00" } : h));
    expect(hostedErrors({ ...b, hours }, NOW)).toEqual({ "hours.1": "hoursOrder" });
    expect(hostedErrors({ ...b, address: "", website: "" }, NOW)).toEqual({});
  });

  it("business hours: today and the status in the business's time zone", () => {
    const b = { ...(sampleHostedContent("business") as BusinessContent), timeZone: "America/Los_Angeles" };
    // Wed 2026-11-25 12:00 UTC = Wed 04:00 in Los Angeles: before opening (10:00).
    expect(businessNow(b, NOW)).toEqual({ day: 2, status: { kind: "before", from: "10:00" } });
    // 19:00 UTC = 11:00 there: open until 18:00.
    expect(businessNow(b, new Date("2026-11-25T19:00:00Z"))).toEqual({ day: 2, status: { kind: "open", to: "18:00" } });
    // Monday is closed in the example.
    expect(businessNow(b, new Date("2026-11-23T20:00:00Z")).status).toEqual({ kind: "closedToday" });
  });

  it("apps: at least one store; links must be on the store's own domain", () => {
    const a = sampleHostedContent("apps");
    if (a.type !== "apps") throw new Error();
    expect(hostedErrors({ ...a, ios: "", android: "" }, NOW)).toEqual({ ios: "appStores" });
    expect(hostedErrors({ ...a, ios: "evil.com/apps.apple.com/x", android: "play.google.com.evil.com/x" }, NOW)).toEqual({
      ios: "appStoreLink",
      android: "googlePlayLink",
    });
    expect(storeLinkOk("ios", "https://apps.apple.com/app/id1")).toBe(true);
  });

  it("apps: phones go to their configured store; everything else gets the fallback page", () => {
    const a = sampleHostedContent("apps");
    if (a.type !== "apps") throw new Error();
    const iphone = deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    const android = deviceFromUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9)");
    expect([iphone, android, deviceFromUserAgent("Mozilla/5.0 (Macintosh)"), deviceFromUserAgent(null)]).toEqual([
      "ios",
      "android",
      "other",
      "other",
    ]);
    expect(storeRedirect(a, "ios")).toBe("https://apps.apple.com/app/fern-rewards");
    expect(storeRedirect(a, "android")).toMatch(/^https:\/\/play\.google\.com\//);
    expect(storeRedirect({ ...a, android: "" }, "android")).toBeNull();
    expect(storeRedirect(a, "other")).toBeNull();
  });

  it("product: name and a valid link; price digits; at most 5 photos", () => {
    const p = sampleHostedContent("product");
    if (p.type !== "product") throw new Error();
    expect(hostedErrors({ ...p, link: "", price: "38 USD" }, NOW)).toEqual({ link: "productLink", price: "productPrice" });
    expect(readHostedContent({ ...p, images: Array(6).fill("asset:abcdefgh") })).toBeNull();
    expect(readHostedContent({ ...p, images: ["data:image/gif;base64,R0lG"] })).toBeNull();
  });

  it("pdf: refuses files over 300 pages in the stored shape; lists the file among the content's assets", () => {
    const f = { ...emptyHostedContent("pdf"), title: "T", file: { asset: "asset:pdf123456", name: "a.pdf", bytes: 10, pages: 301 } };
    expect(readHostedContent(f)).toBeNull();
    const ok = { ...f, file: { ...f.file, pages: 300 } };
    expect(readHostedContent(ok)).not.toBeNull();
    expect(hostedAssetIds(ok as never)).toEqual(["pdf123456"]);
  });

  it("the stored shape is strict: unknown fields and wrong versions are refused", () => {
    expect(readHostedContent({ ...sampleHostedContent("menu"), owner: "x" })).toBeNull();
    expect(readHostedContent({ ...sampleHostedContent("menu"), v: 2 })).toBeNull();
  });
});
