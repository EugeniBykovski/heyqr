import { layoutCapacity, QrCapacityError } from "@heyqr/qr-core";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { canDownload } from "@/server/billing/entitlements";
import { encodedValue, ExportSizeError, renderExport } from "@/server/qr/export";
import { getLayoutWithQr } from "@/server/qr/repository";

const query = z.object({
  format: z.enum(["png", "svg", "pdf"]).default("png"),
  dpi: z.coerce.number().int().min(72).max(1200).optional(),
  scale: z.coerce.number().int().min(1).max(8).optional(),
  transparent: z.enum(["0", "1"]).optional(),
});

/**
 * The only place full-size files come from. The browser never receives a downloadable file
 * before the server has checked the purchase or the Dynamic plan.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/[layoutId]">) {
  const { layoutId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const { format, dpi, scale, transparent } = parsed.data;

  const record = await getLayoutWithQr(layoutId);
  if (!record || record.qrCode.userId !== session.user.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canDownload(session.user.id, record.qrCode))) return NextResponse.json({ error: "payment_required" }, { status: 402 });
  if (format === "pdf") return NextResponse.json({ error: "not_implemented", ticket: "HEY-21" }, { status: 501 });

  const value = encodedValue(record.qrCode);
  // HEY-24: content that doesn't fit is a clear 422, never a 500 or a truncated code. Sizes only, no content.
  const capacity = layoutCapacity(record.design.layout, value);
  const tooLong = { error: "too_long", bytes: capacity.bytes, maxBytes: capacity.maxBytes } as const;
  if (!capacity.ok) return NextResponse.json(tooLong, { status: 422 });
  let file;
  try {
    file = await renderExport(record.design.layout, value, format, { dpi, scale, transparent: transparent === "1" });
  } catch (error) {
    if (error instanceof QrCapacityError) return NextResponse.json(tooLong, { status: 422 });
    // HEY-37: a resolution outside the export limits is refused, never silently scaled down.
    if (error instanceof ExportSizeError) return NextResponse.json({ error: "too_large", ...error.size }, { status: 422 });
    throw error;
  }
  if (!file.scan.ok) return NextResponse.json({ error: "scan_check_failed", issues: file.scan.issues }, { status: 422 });

  const safeName =
    record.name
      .replace(/[^\p{L}\p{N}\- ]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "qr-code";
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${safeName}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
