import "server-only";
import Stripe from "stripe";
import { paymentsConfig } from "@/server/config";

let client: Stripe | null = null;

/** Lazily created so builds and tests don't need Stripe keys; throws IntegrationNotConfiguredError when they're missing. */
export function stripe(): Stripe {
  client ??= new Stripe(paymentsConfig().STRIPE_SECRET_KEY, { appInfo: { name: "Hey QR" } });
  return client;
}
