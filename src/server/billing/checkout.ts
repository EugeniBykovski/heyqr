import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "@/env";
import { pricePoint, type Currency, type Offer, type PlanId } from "@/shared/config/catalog";
import { db, schema } from "../db";
import type { PurchaseItem, PurchaseLine } from "../db/schema";
import { newId } from "../db/ids";
import { priceMatches, stripePriceFor } from "./catalog";
import { stripe } from "./stripe";

async function customerFor(user: { id: string; email: string; name: string; stripeCustomerId?: string | null }) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
  await db.update(schema.user).set({ stripeCustomerId: customer.id }).where(eq(schema.user.id, user.id));
  return customer.id;
}

function checkoutUrl(session: { url: string | null }): string {
  if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
  return session.url;
}

/** A checkout the catalog can't charge as shown: the offer isn't sold in this currency, or its Stripe Price differs. */
export class CatalogError extends Error {
  constructor(readonly code: "not_offered" | "price_mismatch") {
    super(code);
  }
}

/** The verified Stripe Price of an offer in a currency (its currency, amount and interval equal the shown price). */
async function verifiedPrice(currency: Currency, offer: Offer): Promise<string> {
  const id = stripePriceFor(currency, offer);
  if (!id || pricePoint(currency, offer) === null) throw new CatalogError("not_offered");
  const price = await stripe().prices.retrieve(id);
  if (!priceMatches(price, currency, offer)) throw new CatalogError("price_mismatch");
  return id;
}

type User = { id: string; email: string; name: string; stripeCustomerId?: string | null };
type ExportBack = {
  qrCodeId: string;
  layoutId: string;
  format: "png" | "svg" | "pdf";
  locale: string;
  resolution?: number;
  transparent?: boolean;
  printPack?: boolean;
};

/**
 * Where Stripe returns to: the same export screen with the same code, layout and file settings (design 3.5 / 3.9).
 * The code id is required: the export page looks the code up by it.
 */
export function exportReturnUrl(input: ExportBack) {
  const q = new URLSearchParams({ qr: input.qrCodeId, layout: input.layoutId, format: input.format });
  if (input.resolution !== undefined) q.set("res", String(input.resolution));
  if (input.transparent) q.set("transparent", "1");
  if (input.printPack) q.set("printPack", "1");
  return `${env.NEXT_PUBLIC_APP_URL}/${input.locale}/create/export?${q.toString()}`;
}

async function session(input: {
  user: User;
  mode: "payment" | "subscription";
  prices: string[];
  back: string;
  metadata: Record<string, string>;
  purchase?: { qrCodeId: string | null; item: PurchaseItem; lines: PurchaseLine[]; currency: Currency };
}): Promise<string> {
  const customer = await customerFor(input.user);
  const join = input.back.includes("?") ? "&" : "?";
  const created = await stripe().checkout.sessions.create({
    mode: input.mode,
    customer,
    line_items: input.prices.map((price) => ({ price, quantity: 1 })),
    success_url: `${input.back}${join}checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.back}${join}checkout=cancelled`,
    metadata: input.metadata,
    ...(input.mode === "payment"
      ? { payment_intent_data: { metadata: input.metadata } }
      : { subscription_data: { metadata: input.metadata } }),
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
    customer_update: { address: "auto" },
  });
  if (input.purchase)
    await db.insert(schema.purchase).values({
      id: newId(),
      userId: input.user.id,
      qrCodeId: input.purchase.qrCodeId,
      item: input.purchase.item,
      lines: input.purchase.lines,
      stripeCheckoutSessionId: created.id,
      amountTotal: created.amount_total ?? input.purchase.lines.reduce((s, l) => s + l.amount, 0),
      currency: (created.currency ?? input.purchase.currency).toLowerCase(),
    });
  return checkoutUrl(created);
}

const line = (currency: Currency, offer: PurchaseLine["offer"]): PurchaseLine => ({ offer, amount: pricePoint(currency, offer) ?? 0 });

/**
 * Design 3.4 / 7.2 / 7.3: a code's checkout, itemized. Static: Single QR, plus its Print Pack when switched on
 * (eligible mm layouts only). Dynamic: the plan (Starter by default), plus the Print Pack on the first invoice.
 * Returns to the same export screen and settings.
 */
export async function createCheckout(input: ExportBack & { user: User; currency: Currency; plan?: PlanId }): Promise<string> {
  const { user, currency } = input;
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, user.id), isNull(schema.qrCode.deletedAt)),
    with: { layouts: true },
  });
  const layout = qr?.layouts.find((l) => l.id === input.layoutId);
  // The action checks the same; a code and layout that don't belong together never reach Stripe.
  if (!qr || !layout) throw new Error("QR code not found");
  const printPack = Boolean(input.printPack) && layout?.design.layout.unit === "mm" && !qr.printPackAt;
  const back = exportReturnUrl({ ...input, printPack });
  const metadata: Record<string, string> = {
    userId: user.id,
    qrCodeId: qr.id,
    layoutId: input.layoutId,
    format: input.format,
    kind: "code",
    currency,
    ...(printPack ? { printPack: "1" } : {}),
  };

  if (qr.model === "dynamic") {
    const plan = input.plan ?? "starter";
    const prices = [await verifiedPrice(currency, plan), ...(printPack ? [await verifiedPrice(currency, "printPack")] : [])];
    return session({ user, mode: "subscription", prices, back, metadata: { ...metadata, plan } });
  }
  const prices = [await verifiedPrice(currency, "single"), ...(printPack ? [await verifiedPrice(currency, "printPack")] : [])];
  return session({
    user,
    mode: "payment",
    prices,
    back,
    metadata,
    purchase: {
      qrCodeId: qr.id,
      item: printPack ? "single_qr_print_pack" : "single_qr",
      lines: [line(currency, "single"), ...(printPack ? [line(currency, "printPack")] : [])],
      currency,
    },
  });
}

/** Design 4.8 "Buy 3 credits" / 10: a Static Pack. Credits are added by the webhook once Stripe confirms payment. */
export async function createPackCheckout(input: {
  user: User;
  currency: Currency;
  pack: "pack3" | "pack10";
  locale: string;
}): Promise<string> {
  const price = await verifiedPrice(input.currency, input.pack);
  return session({
    user: input.user,
    mode: "payment",
    prices: [price],
    back: `${env.NEXT_PUBLIC_APP_URL}/${input.locale}/dashboard/billing`,
    metadata: { userId: input.user.id, kind: "pack", pack: input.pack, currency: input.currency },
    purchase: { qrCodeId: null, item: input.pack, lines: [line(input.currency, input.pack)], currency: input.currency },
  });
}

/**
 * Design 4.8 / 9.1 "Choose Studio" / "Activate Starter": the plan itself, from Pricing, Billing or the trial. With the
 * trial's test code, that code keeps its short link (the webhook activates it under the plan).
 */
export async function createPlanCheckout(input: {
  user: User;
  currency: Currency;
  plan: PlanId;
  locale: string;
  qrCodeId?: string;
  returnTo: "billing" | "trial";
}): Promise<string> {
  const price = await verifiedPrice(input.currency, input.plan);
  const path = input.returnTo === "trial" ? "dashboard/trial" : "dashboard/billing";
  return session({
    user: input.user,
    mode: "subscription",
    prices: [price],
    back: `${env.NEXT_PUBLIC_APP_URL}/${input.locale}/${path}`,
    metadata: {
      userId: input.user.id,
      kind: "plan",
      plan: input.plan,
      currency: input.currency,
      ...(input.qrCodeId ? { qrCodeId: input.qrCodeId } : {}),
    },
  });
}

/**
 * Design 8.2 "Unlock Print Pack": a one-time payment for this code's Print Pack. Returns to Print Preview with the same
 * layout and print settings. The webhook grants it (qr_code.print_pack_at); the client never does.
 */
export async function createPrintPackCheckout(input: {
  user: User;
  currency: Currency;
  qrCodeId: string;
  layoutId: string;
  settings: string;
  locale: string;
}): Promise<string> {
  const price = await verifiedPrice(input.currency, "printPack");
  const qr = await db.query.qrCode.findFirst({
    where: and(eq(schema.qrCode.id, input.qrCodeId), eq(schema.qrCode.userId, input.user.id), isNull(schema.qrCode.deletedAt)),
  });
  if (!qr) throw new Error("QR code not found");
  const back = `${env.NEXT_PUBLIC_APP_URL}/${input.locale}/print?${new URLSearchParams({ qr: input.qrCodeId, layout: input.layoutId }).toString()}&${input.settings}`;
  return session({
    user: input.user,
    mode: "payment",
    prices: [price],
    back,
    metadata: { userId: input.user.id, qrCodeId: input.qrCodeId, layoutId: input.layoutId, kind: "print_pack", currency: input.currency },
    purchase: { qrCodeId: input.qrCodeId, item: "print_pack", lines: [line(input.currency, "printPack")], currency: input.currency },
  });
}

/** Stripe customer portal for plan changes, cancellation and receipts. */
export async function createPortalSession(stripeCustomerId: string, locale: string) {
  const portal = await stripe().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/${locale}/dashboard/billing`,
  });
  return portal.url;
}
