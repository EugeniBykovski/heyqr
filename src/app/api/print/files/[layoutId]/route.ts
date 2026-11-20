import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { getSession } from "@/server/auth";
import { loadPrint } from "@/server/print/load";
import { printFileResponse } from "@/server/print/files";

const query = z.object({ file: z.enum(["pdf", "svg", "spec"]), key: z.string().min(8).max(64), locale: z.string().optional() });

/**
 * Design 8.5 / Handoff §4 GET /api/print/files/:layoutId: the Print Pack files of the owner's layout, rendered from the
 * same function and settings as the preview. 402 while the Print Pack is locked; 409 when the layout was saved again
 * (or the settings differ) since the preview, so the files always match what was shown.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/print/files/[layoutId]">) {
  const { layoutId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const q = query.safeParse(params);
  if (!q.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const result = await loadPrint(session.user.id, layoutId, params);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 422 });
  const { layout, page, value, settings, name, layoutName, unlocked } = result.ctx;
  // A download link (nav=1) that can't be served goes back to Print Preview with a notice instead of saving an error.
  const backToPreview = () => {
    const locale = routing.locales.find((l) => l === q.data.locale) ?? routing.defaultLocale;
    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    const qs = new URLSearchParams({
      qr: params.qr ?? "",
      layout: layoutId,
      scale: String(settings.scale),
      bleed: String(settings.bleed),
      cropMarks: settings.cropMarks ? "1" : "0",
      stale: "1",
    });
    return NextResponse.redirect(new URL(`${prefix}/print?${qs.toString()}`, request.nextUrl.origin), 303);
  };
  if (!unlocked) return params.nav === "1" ? backToPreview() : NextResponse.json({ error: "print_pack_locked" }, { status: 402 });
  if (q.data.key !== page.renderKey)
    return params.nav === "1"
      ? backToPreview()
      : NextResponse.json({ error: "revision_changed", renderKey: page.renderKey }, { status: 409 });
  if (!page.scanOk) return NextResponse.json({ error: "scan_check_failed" }, { status: 422 });

  return printFileResponse(q.data.file, { layout, page, value, settings, name, layoutName, locale: q.data.locale });
}
