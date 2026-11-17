import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";

const ACTIVE_SUBSCRIPTION = ["active", "trialing", "past_due"];

export async function activeSubscription(userId: string) {
  return db.query.subscription.findFirst({
    where: and(eq(schema.subscription.userId, userId), inArray(schema.subscription.status, ACTIVE_SUBSCRIPTION)),
  });
}

/**
 * The single rule for paid downloads. Static: the code was bought (any layout, any format).
 * Dynamic: the owner has an active Dynamic plan. Never decided on the client.
 */
export async function canDownload(userId: string, qr: { userId: string; model: "static" | "dynamic"; purchasedAt: Date | null }) {
  if (qr.userId !== userId) return false;
  if (qr.model === "static") return qr.purchasedAt !== null;
  return Boolean(await activeSubscription(userId));
}
