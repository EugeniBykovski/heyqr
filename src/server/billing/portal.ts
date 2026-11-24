import "server-only";
import type Stripe from "stripe";
import { env } from "@/env";
import { DEFAULT_LOCALE, LOCALE_CODES, type Locale } from "@/i18n/locales";
import { CURRENCIES, isCurrency } from "@/shared/config/catalog-core";
import { stripePriceFor } from "./catalog";
import { stripe } from "./stripe";

/*
 * HEY-139 / QR-19.02: Stripe's Customer Portal from Plan & billing, for the account's stored Customer (HEY-132).
 * - What the page offers follows the Portal's own configuration (Stripe Dashboard): an action the Portal can't do is
 *   not shown, so every button leads somewhere that works.
 * - The return URL is built on the server, for a supported locale only.
 * - The payment method summary is read from Stripe at render time and masked (brand and last 4); nothing is stored.
 */

export type PortalIntent = "manage" | "payment" | "upgrade";
export const isPortalIntent = (v: unknown): v is PortalIntent => v === "manage" || v === "payment" || v === "upgrade";

/** What the default Portal configuration lets an owner do. */
export type PortalFeatures = { paymentMethodUpdate: boolean; cancel: boolean; upgrade: boolean };

const NONE: PortalFeatures = { paymentMethodUpdate: false, cancel: false, upgrade: false };
let cached: { at: number; features: PortalFeatures } | null = null;
const TTL_MS = 5 * 60_000;

/** The default Portal configuration's features, cached for a few minutes. Unreachable Stripe: nothing beyond Manage. */
export async function portalFeatures(): Promise<PortalFeatures> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.features;
  try {
    const [config] = (await stripe().billingPortal.configurations.list({ is_default: true, active: true, limit: 1 })).data;
    const studio = CURRENCIES.map((c) => stripePriceFor(c, "studio")).filter((p): p is string => Boolean(p));
    const features: PortalFeatures = config
      ? {
          paymentMethodUpdate: config.features.payment_method_update.enabled,
          cancel: config.features.subscription_cancel.enabled,
          // Upgrades go through the Portal's update flow, which must be on and offer a catalog Studio Price.
          upgrade:
            config.features.subscription_update.enabled &&
            (config.features.subscription_update.products ?? []).some((p) => p.prices.some((price) => studio.includes(price))),
        }
      : NONE;
    cached = { at: Date.now(), features };
    return features;
  } catch {
    return NONE;
  }
}

/** Where the Portal returns to: Plan & billing in the owner's language (an unsupported locale falls back to English). */
export function portalReturnUrl(locale: string) {
  const safe: Locale = (LOCALE_CODES as readonly string[]).includes(locale) ? (locale as Locale) : DEFAULT_LOCALE;
  return `${env.NEXT_PUBLIC_APP_URL}/${safe}/dashboard/billing`;
}

/**
 * A Portal session for this Customer. `payment` opens the payment method update and `upgrade` the switch to Studio
 * (both straight to that step, when the configuration allows it); `manage` opens the Portal's home.
 */
export async function createPortalSession(
  customer: string,
  locale: string,
  intent: PortalIntent = "manage",
  subscriptionId?: string | null,
): Promise<string> {
  const return_url = portalReturnUrl(locale);
  let flow_data: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
  if (intent === "payment") flow_data = { type: "payment_method_update" };
  if (intent === "upgrade" && subscriptionId) {
    // Studio in the subscription's own currency (the catalog's Price for it).
    const sub = await stripe().subscriptions.retrieve(subscriptionId);
    const currency = sub.currency.toUpperCase();
    const studio = isCurrency(currency) ? stripePriceFor(currency, "studio") : null;
    const item = sub.items.data[0];
    if (item && studio)
      flow_data = {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription: subscriptionId, items: [{ id: item.id, price: studio, quantity: 1 }] },
        after_completion: { type: "redirect", redirect: { return_url } },
      };
  }
  const portal = await stripe().billingPortal.sessions.create({ customer, return_url, ...(flow_data ? { flow_data } : {}) });
  return portal.url;
}

/** A card or other method, masked for display. */
export type PaymentSummary = { kind: "card"; brand: string; last4: string } | { kind: "other"; type: string };

const summarize = (pm: Stripe.PaymentMethod | string | null | undefined): PaymentSummary | null => {
  if (!pm || typeof pm === "string") return null;
  if (pm.type === "card" && pm.card) return { kind: "card", brand: pm.card.brand, last4: pm.card.last4 };
  return { kind: "other", type: pm.type };
};

/**
 * The payment method Stripe will charge next: the subscription's own default, else the Customer's invoice default.
 * Null when there is none or Stripe can't be reached (the page then says it's kept by Stripe).
 */
export async function paymentSummary(customer: string, subscriptionId: string | null): Promise<PaymentSummary | null> {
  try {
    if (subscriptionId) {
      const sub = await stripe().subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
      const own = summarize(sub.default_payment_method);
      if (own) return own;
    }
    const c = await stripe().customers.retrieve(customer, { expand: ["invoice_settings.default_payment_method"] });
    return c.deleted ? null : summarize(c.invoice_settings?.default_payment_method);
  } catch {
    return null;
  }
}
