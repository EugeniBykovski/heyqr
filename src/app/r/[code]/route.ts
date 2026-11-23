import { eq } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { db, schema } from "@/server/db";
import { activeSubscription } from "@/server/billing/entitlements";
import { trialCovers, trialPhase } from "@/server/billing/trial";
import { recordScan } from "@/server/qr/repository";

/**
 * HEY-120 / QR-16.05: every answer is a 302 that no browser, proxy or CDN may store. The same short link must follow a
 * destination change (or a pause, or a reactivation) on the very next scan.
 */
const redirect = (to: string | URL) => NextResponse.redirect(to, { status: 302, headers: { "Cache-Control": "no-store" } });

/**
 * Dynamic code redirect. The printed code always points here; the destination can change any time.
 * The scan is counted after the response is sent, so the redirect stays fast. Only a redirect to the destination counts.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const { code } = await ctx.params;
  const qr = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.shortCode, code) });
  if (!qr || qr.deletedAt || qr.status !== "active" || !qr.destination)
    return redirect(new URL("/link-unavailable", env.NEXT_PUBLIC_APP_URL));
  // Design 9.3: the trial's test code redirects while the trial runs or a Dynamic plan is active; after that it is
  // inactive (nothing deleted) until the plan is taken, which turns the same short link back on. HEY-121: the scanner
  // gets a neutral "not available right now"; the reason never names the trial, the plan or the owner.
  if (qr.isTrial) {
    const [owner, subscription] = await Promise.all([
      db.query.user.findFirst({ where: eq(schema.user.id, qr.userId) }),
      activeSubscription(qr.userId),
    ]);
    const phase = trialPhase(
      { trialStartedAt: owner?.trialStartedAt ?? null, trialEndsAt: owner?.trialEndsAt ?? null },
      Boolean(subscription),
    );
    if (!subscription && !trialCovers(phase, qr)) return redirect(new URL("/link-unavailable?reason=inactive", env.NEXT_PUBLIC_APP_URL));
  }

  after(() => recordScan(qr.id));
  return redirect(qr.destination);
}
