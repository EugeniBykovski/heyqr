import "server-only";
import Stripe from "stripe";
import { env } from "@/env";

let client: Stripe | null = null;

/** Lazily created so builds and tests don't need Stripe keys. */
export function stripe(): Stripe {
  client ??= new Stripe(env.STRIPE_SECRET_KEY, { appInfo: { name: "Hey QR" } });
  return client;
}
