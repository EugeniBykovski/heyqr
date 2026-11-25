import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { isHostedContent } from "../../entities/qr/model/hosted";
import * as schema from "../db/schema";
import { latestHostedVersion, type HostedVersion } from "../qr/hosted";
import { hasPlanAccess, PLAN_STATUSES } from "./allowances";
import { trialCovers, trialPhase, type TrialPhase } from "./trial";

/*
 * HEY-142 / HEY-143: the access decisions every entry point shares, on a given database and at a given time:
 * the subscription that gives paid access, paid downloads, and what the public short link answers. Plain module (no
 * "server-only", no app database) so the PostgreSQL tests exercise exactly what the app runs.
 */
type Db = NodePgDatabase<typeof schema>;

/** The account's subscription that gives paid access at `now` (hasPlanAccess), or undefined. */
export async function accessSubscription(db: Db, userId: string, now: Date = new Date()) {
  const subs = await db.query.subscription.findMany({
    where: and(eq(schema.subscription.userId, userId), inArray(schema.subscription.status, PLAN_STATUSES)),
  });
  return subs.find((s) => hasPlanAccess(s, now));
}

/** The account's Starter trial (design 9.x), from its dates and whether a Dynamic plan gives access. */
export async function trialFor(db: Db, userId: string, now: Date = new Date()): Promise<TrialPhase> {
  const [owner, subscription] = await Promise.all([
    db.query.user.findFirst({ where: eq(schema.user.id, userId) }),
    accessSubscription(db, userId, now),
  ]);
  return trialPhase({ trialStartedAt: owner?.trialStartedAt ?? null, trialEndsAt: owner?.trialEndsAt ?? null }, Boolean(subscription), now);
}

export type DownloadableCode = {
  userId: string;
  model: "static" | "dynamic";
  purchasedAt: Date | null;
  isTrial?: boolean;
  status?: string;
  shortCode?: string | null;
};

/**
 * The single rule for paid downloads. Static: the code was bought (any layout, any format). Dynamic: a live code of an
 * owner with paid access, or the trial's test code while the trial runs. Never decided on the client.
 */
export async function canDownloadCode(db: Db, userId: string, qr: DownloadableCode, now: Date = new Date()) {
  if (qr.userId !== userId) return false;
  if (qr.model === "static") return qr.purchasedAt !== null;
  // A Dynamic code's files carry its short link: only a live code (activated under the plan) can be downloaded.
  if (qr.status === "active" && qr.shortCode && (await accessSubscription(db, userId, now))) return true;
  return qr.isTrial === true && trialCovers(await trialFor(db, userId, now), { isTrial: true });
}

export type ShortLinkAnswer =
  | { kind: "redirect"; to: string; qrCodeId: string }
  /** A hosted page (design 11.0): its latest published version, shown at /p/<code>. */
  | { kind: "hosted"; qrCodeId: string; shortCode: string; page: HostedVersion }
  | { kind: "unavailable"; inactive: boolean };

/**
 * What /r/<code> answers (the route sends it as a no-store 302 and counts a scan only for a redirect):
 * - unknown, deleted, paused, draft or destination-less: the generic unavailable page;
 * - a hosted page: its latest published version (never the draft); one never published is unavailable;
 * - the trial's test code: redirects while the trial runs or a plan gives access, else "not active right now";
 * - any other live Dynamic code (HEY-142): redirects while its owner has paid access, else "not active right now".
 * The code itself is never changed here, so the same printed code redirects again once access is back.
 */
export async function resolveShortLink(db: Db, code: string, now: Date = new Date()): Promise<ShortLinkAnswer> {
  const qr = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.shortCode, code) });
  const hosted = qr?.content ? isHostedContent(qr.content) : false;
  // A hosted code has no destination: its page lives behind the short link.
  if (!qr || qr.deletedAt || qr.status !== "active" || (!hosted && !qr.destination)) return { kind: "unavailable", inactive: false };
  const subscription = await accessSubscription(db, qr.userId, now);
  if (qr.isTrial) {
    const owner = await db.query.user.findFirst({ where: eq(schema.user.id, qr.userId) });
    const phase = trialPhase(
      { trialStartedAt: owner?.trialStartedAt ?? null, trialEndsAt: owner?.trialEndsAt ?? null },
      Boolean(subscription),
      now,
    );
    if (!subscription && !trialCovers(phase, qr)) return { kind: "unavailable", inactive: true };
  } else if (!subscription) return { kind: "unavailable", inactive: true };
  if (hosted) {
    // Visitors only ever see the latest published version; a code never published has nothing to show.
    const page = await latestHostedVersion(db, qr.id);
    return page ? { kind: "hosted", qrCodeId: qr.id, shortCode: code, page } : { kind: "unavailable", inactive: false };
  }
  if (!qr.destination) return { kind: "unavailable", inactive: false };
  return { kind: "redirect", to: qr.destination, qrCodeId: qr.id };
}
