import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { db } from "@/server/db";
import { resolveShortLink } from "@/server/billing/access";
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
  // HEY-143: the decision (trial, paid access at the cutoff, paused/deleted) is resolveShortLink, shared with the tests.
  const answer = await resolveShortLink(db, code);
  if (answer.kind === "unavailable")
    return redirect(new URL(answer.inactive ? "/link-unavailable?reason=inactive" : "/link-unavailable", env.NEXT_PUBLIC_APP_URL));
  after(() => recordScan(answer.qrCodeId));
  return redirect(answer.to);
}
