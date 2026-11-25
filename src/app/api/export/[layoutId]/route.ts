import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { canDownload } from "@/server/billing/entitlements";
import { deliverLayoutExport } from "@/server/qr/layout-export";
import { getLayoutWithQr } from "@/server/qr/repository";

const query = z.object({
  format: z.enum(["png", "svg", "pdf"]).default("png"),
  dpi: z.coerce.number().int().min(72).max(1200).optional(),
  scale: z.coerce.number().int().min(1).max(8).optional(),
  transparent: z.enum(["0", "1"]).optional(),
  /** HEY-102: when given, the code the layout must belong to (a mismatched pair is refused like another account's). */
  qr: z.string().min(1).max(64).optional(),
  prepare: z.enum(["1"]).optional(),
});

/**
 * The only place full-size files come from. The browser never receives a downloadable file
 * before the server has checked the purchase or the Dynamic plan.
 * HEY-102: checked on every request (owner, the exact code and layout, not deleted, entitlement), then delivered from
 * private storage through a short-lived signed link (deliverLayoutExport → deliverPaidFile); `?prepare=1` only makes
 * sure the file exists. The public API (HEY-158) delivers through the same deliverLayoutExport.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[layoutId]">) {
  const { layoutId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const { format, dpi, scale, transparent } = parsed.data;

  // getLayoutWithQr leaves out deleted codes; another account's layout, or a layout of another code than `qr`, is 404.
  const record = await getLayoutWithQr(layoutId);
  if (!record || record.qrCode.userId !== session.user.id || (parsed.data.qr !== undefined && parsed.data.qr !== record.qrCode.id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canDownload(session.user.id, record.qrCode))) return NextResponse.json({ error: "payment_required" }, { status: 402 });

  return deliverLayoutExport(request, session.user.id, record, {
    format,
    ...(dpi === undefined ? {} : { dpi }),
    ...(scale === undefined ? {} : { scale }),
    transparent: transparent === "1",
  });
}
