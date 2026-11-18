import { NextResponse } from "next/server";
import { stripe } from "@/server/billing/stripe";
import { handleStripeEvent } from "@/server/billing/webhook";
import { isConfigured, paymentsConfig } from "@/server/config";

/** Stripe → Hey QR. The signature is checked on the raw body; processing is idempotent. */
export async function POST(request: Request) {
  if (!isConfigured("payments")) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  let event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, paymentsConfig().STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const processed = await handleStripeEvent(event);
  return NextResponse.json({ received: true, duplicate: !processed });
}
