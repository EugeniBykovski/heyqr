import { layoutCapacity, PNG_DEFAULTS, QrCapacityError } from "@heyqr/qr-core";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { layoutPdf } from "@/server/print/print";
import { canDownload } from "@/server/billing/entitlements";
import { downloadFileName, encodedValue, ExportSizeError, renderExport, withEmbeddedImages } from "@/server/qr/export";
import { deliverPaidFile } from "@/server/qr/paid-delivery";
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
 * private storage through a short-lived signed link (deliverPaidFile); `?prepare=1` only makes sure the file exists.
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

  const value = encodedValue(record.qrCode);
  // HEY-24: content that doesn't fit is a clear 422, never a 500 or a truncated code. Sizes only, no content.
  const capacity = layoutCapacity(record.design.layout, value);
  const tooLong = { error: "too_long", bytes: capacity.bytes, maxBytes: capacity.maxBytes } as const;
  if (!capacity.ok) return NextResponse.json(tooLong, { status: 422 });

  // Normalized settings: what actually changes the file (SVG and PDF are vector, PNG has one resolution per unit).
  const mm = record.design.layout.unit === "mm";
  const resolution = format === "png" ? (mm ? { dpi: dpi ?? PNG_DEFAULTS.dpi } : { scale: scale ?? PNG_DEFAULTS.scale }) : {};
  const settings = { format, ...resolution, transparent: transparent === "1" };
  return deliverPaidFile(
    request,
    {
      userId: session.user.id,
      qrCodeId: record.qrCode.id,
      scope: record.id,
      revision: record.updatedAt.toISOString(),
      kind: format,
      ext: format,
      facts: { settings, design: record.design, value, name: record.name },
    },
    async () => {
      if (format === "pdf") {
        const pdf = await layoutPdf(await withEmbeddedImages(record.design.layout), value, { transparent: settings.transparent });
        if (!pdf.scanOk) return NextResponse.json({ error: "scan_check_failed" }, { status: 422 });
        return new NextResponse(new Uint8Array(pdf.body), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": downloadFileName(record.name, "pdf").header,
            "Cache-Control": "private, no-store",
          },
        });
      }
      let file;
      try {
        file = await renderExport(record.design.layout, value, format, { ...resolution, transparent: settings.transparent });
      } catch (error) {
        if (error instanceof QrCapacityError) return NextResponse.json(tooLong, { status: 422 });
        // HEY-37: a resolution outside the export limits is refused, never silently scaled down.
        if (error instanceof ExportSizeError) return NextResponse.json({ error: "too_large", ...error.size }, { status: 422 });
        throw error;
      }
      if (!file.scan.ok) return NextResponse.json({ error: "scan_check_failed", issues: file.scan.issues }, { status: 422 });
      return new NextResponse(new Uint8Array(file.body), {
        headers: {
          "Content-Type": file.contentType,
          "Content-Disposition": downloadFileName(record.name, format).header,
          "Cache-Control": "private, no-store",
        },
      });
    },
  );
}
