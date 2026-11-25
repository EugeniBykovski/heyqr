import { hostedHref, type AppsContent } from "../../entities/qr/model/hosted";

/*
 * Apps pages (design 11.8 / 11.0 "Apps fallback"): a recognized phone goes straight to its own store when the owner
 * added that store; everything else (a computer, an unknown device, a phone whose store is missing) gets the hosted
 * fallback page, which shows only the stores that are configured.
 *
 * iPadOS reports itself as a Mac, so it lands on the fallback page, which still offers the App Store button.
 */
export type Device = "ios" | "android" | "other";

export function deviceFromUserAgent(ua: string | null | undefined): Device {
  const s = ua ?? "";
  if (/\b(iPhone|iPad|iPod)\b/.test(s)) return "ios";
  if (/\bAndroid\b/i.test(s)) return "android";
  return "other";
}

/** The store to send this device to, or null for the fallback page. */
export function storeRedirect(content: AppsContent, device: Device): string | null {
  if (device === "ios" && content.ios.trim()) return hostedHref(content.ios);
  if (device === "android" && content.android.trim()) return hostedHref(content.android);
  return null;
}
