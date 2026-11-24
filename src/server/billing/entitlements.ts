import "server-only";
import type { Currency, Offer } from "@/shared/config/catalog";
import { purchasable } from "./catalog";
import { isConfigured } from "../config";
import { db } from "../db";
import { accessSubscription, canDownloadCode, trialFor, type DownloadableCode } from "./access";
import type { TrialPhase } from "./trial";

/**
 * The account's subscription that gives paid access now (HEY-142: hasPlanAccess, the same rule as slots and
 * allowances), or undefined. HEY-143: the decision lives in access.ts, on the app's database here.
 */
export const activeSubscription = (userId: string, now: Date = new Date()) => accessSubscription(db, userId, now);

/** The account's Starter trial (design 9.x), from its dates and whether a Dynamic plan is active. */
export const userTrial = (userId: string, now: Date = new Date()): Promise<TrialPhase> => trialFor(db, userId, now);

/** Design 8.x: the Print Pack files of a code: the code itself is unlocked and its Print Pack was bought. */
export async function canDownloadPrintPack(
  userId: string,
  qr: {
    userId: string;
    model: "static" | "dynamic";
    purchasedAt: Date | null;
    isTrial?: boolean;
    status?: string;
    shortCode?: string | null;
    printPackAt: Date | null;
  },
) {
  return qr.printPackAt !== null && (await canDownload(userId, qr));
}

/** Whether the Print Pack can be bought in this currency (payments configured, a price point and a Stripe Price). */
export const printPackForSale = (currency: Currency) => isConfigured("payments") && purchasable(currency, "printPack");

/** Whether an offer can be bought in this currency here (payments configured and the catalog has it). */
export const forSale = (currency: Currency, offer: Offer) => isConfigured("payments") && purchasable(currency, offer);

/** The single rule for paid downloads (access.ts canDownloadCode), on the app's database. */
export const canDownload = (userId: string, qr: DownloadableCode) => canDownloadCode(db, userId, qr);
