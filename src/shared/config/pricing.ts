import { env } from "@/env";

/** Display prices only. What is charged is decided by the Stripe price IDs on the server. */
export const pricing = {
  currency: env.NEXT_PUBLIC_PRICE_CURRENCY ?? "USD",
  staticCents: env.NEXT_PUBLIC_PRICE_STATIC_CENTS ?? 499,
  dynamicMonthlyCents: env.NEXT_PUBLIC_PRICE_DYNAMIC_MONTHLY_CENTS ?? 600,
};
