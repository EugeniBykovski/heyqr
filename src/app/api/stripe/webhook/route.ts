import { NextResponse } from "next/server";
import { env } from "@/env";
import { stripe } from "@/server/billing/stripe";
import { handleStripeEvent } from "@/server/billing/webhook";

/** Stripe → Hey QR. The signature is checked on the raw body; processing is idempotent. */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  let event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const processed = await handleStripeEvent(event);
  return NextResponse.json({ received: true, duplicate: !processed });
}
