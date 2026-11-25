import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { db } from "@/server/db";
import { resolveShortLink } from "@/server/billing/access";
import { recordScan } from "@/server/qr/repository";
import { isCountableScan } from "@/server/qr/scans";
import { reportFailure, requestIdOf } from "@/server/monitoring";
import { deviceFromUserAgent, storeRedirect } from "@/server/qr/hosted-device";

/**
 * HEY-120 / QR-16.05: every answer is a 302 that no browser, proxy or CDN may store. The same short link must follow a
 * destination change (or a pause, or a reactivation) on the very next scan.
 */
const redirect = (to: string | URL) => NextResponse.redirect(to, { status: 302, headers: { "Cache-Control": "no-store" } });

/**
 * Dynamic code redirect. The printed code always points here; the destination can change any time.
 * The scan is counted after the response is sent, so the redirect stays fast. Only a redirect to the destination counts.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const { code } = await ctx.params;
  // HEY-143: the decision (trial, paid access at the cutoff, paused/deleted) is resolveShortLink, shared with the tests.
  let answer: Awaited<ReturnType<typeof resolveShortLink>>;
  try {
    answer = await resolveShortLink(db, code);
  } catch (error) {
    // HEY-175: the lookup itself failed (an unavailable code is an answer, not a failure). The short code isn't sent.
    reportFailure(error, { operation: "qr.resolve", severity: "high", route: "/r/[code]", correlationId: requestIdOf(request.headers) });
    throw error;
  }
  if (answer.kind === "unavailable")
    return redirect(new URL(answer.inactive ? "/link-unavailable?reason=inactive" : "/link-unavailable", env.NEXT_PUBLIC_APP_URL));
  // Hosted pages (design 11.0) live at /p/<code>; an Apps page sends a recognized phone straight to its store.
  const to =
    answer.kind === "hosted"
      ? ((answer.page.content.type === "apps"
          ? storeRedirect(answer.page.content, deviceFromUserAgent(request.headers.get("user-agent")))
          : null) ?? new URL(`/p/${answer.shortCode}`, env.NEXT_PUBLIC_APP_URL))
      : answer.to;
  // HEY-146: HEAD, prefetch/prerender and marked test traffic get the same redirect but aren't counted.
  if (!isCountableScan(request.method, request.headers)) return redirect(to);
  // HEY-145: the scan is counted after the 302 is sent (it never delays the redirect). A failed write is logged by code
  // only and dropped: the scanner already has their redirect, and nothing about the request is retried or exposed.
  after(() =>
    recordScan(answer.qrCodeId).catch((error: unknown) => {
      console.error(`[scan] not recorded: ${error instanceof Error ? error.name : "unknown error"}`);
      reportFailure(error, { operation: "qr.scan.record", severity: "low", route: "/r/[code]", log: false });
    }),
  );
  return redirect(to);
}
