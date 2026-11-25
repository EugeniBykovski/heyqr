import "server-only";
import { layoutCapacity, PNG_DEFAULTS, QrCapacityError } from "@heyqr/qr-core";
import { NextResponse } from "next/server";
import { layoutPdf } from "@/server/print/print";
import { downloadFileName, encodedValue, ExportSizeError, renderExport, withEmbeddedImages } from "./export";
import { deliverPaidFile } from "./paid-delivery";
import type { getLayoutWithQr } from "./repository";

export type ExportRecord = NonNullable<Awaited<ReturnType<typeof getLayoutWithQr>>>;
export type ExportFileOptions = { format: "png" | "svg" | "pdf"; dpi?: number; scale?: number; transparent?: boolean };

/**
 * HEY-102 / HEY-158: renders (when not stored yet) and delivers one layout's file through the private export flow
 * (deliverPaidFile: stored once under a server-derived key, then a short-lived signed link). The caller has already
 * checked everything: the owner, the exact code and layout, not deleted, and the entitlement for this request. Shared
 * by the dashboard's /api/export and the public API, so both deliver the same file the same way.
 * Errors are `{ error, … }` JSON with their status (422 too_long / too_large / scan_check_failed).
 */
export async function deliverLayoutExport(
  request: Request,
  userId: string,
  record: ExportRecord,
  options: ExportFileOptions,
): Promise<NextResponse> {
  const { format, dpi, scale } = options;
  const transparent = options.transparent === true;
  const value = encodedValue(record.qrCode);
  // HEY-24: content that doesn't fit is a clear 422, never a 500 or a truncated code. Sizes only, no content.
  const capacity = layoutCapacity(record.design.layout, value);
  const tooLong = { error: "too_long", bytes: capacity.bytes, maxBytes: capacity.maxBytes } as const;
  if (!capacity.ok) return NextResponse.json(tooLong, { status: 422 });

  // Normalized settings: what actually changes the file (SVG and PDF are vector, PNG has one resolution per unit).
  const mm = record.design.layout.unit === "mm";
  const resolution = format === "png" ? (mm ? { dpi: dpi ?? PNG_DEFAULTS.dpi } : { scale: scale ?? PNG_DEFAULTS.scale }) : {};
  const settings = { format, ...resolution, transparent };
  return deliverPaidFile(
    request,
    {
      userId,
      qrCodeId: record.qrCode.id,
      scope: record.id,
      revision: record.updatedAt.toISOString(),
      kind: format,
      ext: format,
      facts: { settings, design: record.design, value, name: record.name },
    },
    async () => {
      if (format === "pdf") {
        const pdf = await layoutPdf(await withEmbeddedImages(record.design.layout), value, { transparent });
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
        file = await renderExport(record.design.layout, value, format, { ...resolution, transparent });
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
