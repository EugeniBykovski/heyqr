import { eq } from "drizzle-orm";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { db, schema } from "@/server/db";
import { recordScan } from "@/server/qr/repository";

/**
 * Dynamic code redirect. The printed code always points here; the destination can change any time.
 * The scan is counted after the response is sent, so the redirect stays fast.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const { code } = await ctx.params;
  const qr = await db.query.qrCode.findFirst({ where: eq(schema.qrCode.shortCode, code) });
  if (!qr || qr.status !== "active" || !qr.destination)
    return NextResponse.redirect(new URL("/link-unavailable", env.NEXT_PUBLIC_APP_URL), 302);

  after(() => recordScan(qr.id));
  return NextResponse.redirect(qr.destination, { status: 302, headers: { "Cache-Control": "no-store" } });
}
