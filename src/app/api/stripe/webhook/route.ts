import { NextResponse } from "next/server";
import { stripe } from "@/server/billing/stripe";
import { handleStripeEvent } from "@/server/billing/webhook";
import { isConfigured, paymentsConfig } from "@/server/config";
import { reportFailure, requestIdOf } from "@/server/monitoring";

/** Stripe → Hey QR. The signature is checked on the raw body; processing is idempotent. */
export async function POST(request: Request) {
  if (!isConfigured("payments")) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  let event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, paymentsConfig().STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    // HEY-175: one bad request is refused as before; a run of them means the webhook secret or endpoint is wrong.
    reportFailure(error, {
      operation: "stripe.webhook.signature",
      severity: "low",
      route: "/api/stripe/webhook",
      correlationId: requestIdOf(request.headers),
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const processed = await handleStripeEvent(event);
    return NextResponse.json({ received: true, duplicate: !processed });
  } catch (error) {
    // HEY-175: fulfillment failed (the order, unlock or subscription wasn't recorded). Reported as a billing failure
    // with the event's type and id (no payload), then rethrown: the 500 makes Stripe retry the event.
    reportFailure(error, {
      operation: "stripe.webhook.fulfill",
      severity: "critical",
      route: "/api/stripe/webhook",
      correlationId: event.id,
      tags: { event_type: event.type, livemode: event.livemode },
    });
    throw error;
  }
}
