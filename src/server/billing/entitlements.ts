import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { trialCovers, trialPhase, type TrialPhase } from "./trial";

const ACTIVE_SUBSCRIPTION = ["active", "trialing", "past_due"];

export async function activeSubscription(userId: string) {
  return db.query.subscription.findFirst({
    where: and(eq(schema.subscription.userId, userId), inArray(schema.subscription.status, ACTIVE_SUBSCRIPTION)),
  });
}

/** The account's Starter trial (design 9.x), from its dates and whether a Dynamic plan is active. */
export async function userTrial(userId: string, now = new Date()): Promise<TrialPhase> {
  const [owner, subscription] = await Promise.all([
    db.query.user.findFirst({ where: eq(schema.user.id, userId) }),
    activeSubscription(userId),
  ]);
  return trialPhase({ trialStartedAt: owner?.trialStartedAt ?? null, trialEndsAt: owner?.trialEndsAt ?? null }, Boolean(subscription), now);
}

/**
 * The single rule for paid downloads. Static: the code was bought (any layout, any format).
 * Dynamic: the owner has an active Dynamic plan, or it is the trial's test code while the trial runs. Never decided on
 * the client.
 */
export async function canDownload(
  userId: string,
  qr: { userId: string; model: "static" | "dynamic"; purchasedAt: Date | null; isTrial?: boolean },
) {
  if (qr.userId !== userId) return false;
  if (qr.model === "static") return qr.purchasedAt !== null;
  if (await activeSubscription(userId)) return true;
  return qr.isTrial === true && trialCovers(await userTrial(userId), { isTrial: true });
}
