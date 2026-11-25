import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth";
import { stripe } from "@/server/billing/stripe";
import { reportFailure, requestIdOf } from "@/server/monitoring";
import { db, schema } from "@/server/db";

/**
 * Design 4.9 "Receipt": Stripe's own receipt for one of the owner's paid purchases (the charge's hosted receipt). The
 * receipt keeps the currency and amounts that were charged. 404 for anything that isn't the user's paid purchase.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/billing/receipt/[purchaseId]">) {
  const { purchaseId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const purchase = await db.query.purchase.findFirst({
    where: and(eq(schema.purchase.id, purchaseId), eq(schema.purchase.userId, session.user.id), eq(schema.purchase.status, "paid")),
  });
  if (!purchase?.stripePaymentIntentId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const intent = await stripe().paymentIntents.retrieve(purchase.stripePaymentIntentId, { expand: ["latest_charge"] });
    const charge = intent.latest_charge;
    const url = charge && typeof charge === "object" ? charge.receipt_url : null;
    if (!url) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.redirect(url, 303);
  } catch (error) {
    reportFailure(error, {
      operation: "billing.receipt",
      severity: "low",
      route: "/api/billing/receipt/[purchaseId]",
      correlationId: requestIdOf(request.headers),
    });
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
