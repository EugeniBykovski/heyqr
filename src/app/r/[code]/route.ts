import { eq } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { db, schema } from "@/server/db";
import { activeSubscription } from "@/server/billing/entitlements";
import { trialCovers, trialPhase } from "@/server/billing/trial";
import { recordScan } from "@/server/qr/repository";

/**
 * Dynamic code redirect. The printed code always points here; the destination can change any time.
 * The scan is counted after the response is sent, so the redirect stays fast.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const { code } = await ctx.params;
  const qr = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.shortCode, code) });
  if (!qr || qr.deletedAt || qr.status !== "active" || !qr.destination)
    return NextResponse.redirect(new URL("/link-unavailable", env.NEXT_PUBLIC_APP_URL), 302);
  // Design 9.3: the trial's test code redirects while the trial runs or a Dynamic plan is active; after that it is
  // paused (nothing deleted) until the plan is taken, which turns the same short link back on.
  if (qr.isTrial) {
    const [owner, subscription] = await Promise.all([
      db.query.user.findFirst({ where: eq(schema.user.id, qr.userId) }),
      activeSubscription(qr.userId),
    ]);
    const phase = trialPhase(
      { trialStartedAt: owner?.trialStartedAt ?? null, trialEndsAt: owner?.trialEndsAt ?? null },
      Boolean(subscription),
    );
    if (!subscription && !trialCovers(phase, qr))
      return NextResponse.redirect(new URL("/link-unavailable?reason=paused", env.NEXT_PUBLIC_APP_URL), {
        status: 302,
        headers: { "Cache-Control": "no-store" },
      });
  }

  after(() => recordScan(qr.id));
  return NextResponse.redirect(qr.destination, { status: 302, headers: { "Cache-Control": "no-store" } });
}
