import { layoutCapacity, PNG_DEFAULTS } from "@heyqr/qr-core";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { canDownload } from "@/server/billing/entitlements";
import { downloadFileName, encodedValue, renderExport } from "@/server/qr/export";
import { reportAndRethrow, requestIdOf } from "@/server/monitoring";
import { deliverPaidFile } from "@/server/qr/paid-delivery";
import { getQrCode } from "@/server/qr/repository";
import { zipFiles } from "@/server/qr/zip";

const query = z.object({ format: z.enum(["png", "svg"]).default("png"), prepare: z.enum(["1"]).optional() });

/**
 * Design 4.3 "Download all": every layout of the owner's unlocked code in one ZIP, each at its default resolution
 * (PNG at 2× for screen layouts, 300 dpi for print layouts) or as SVG. Same entitlement as /api/export.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/export/all/[qrId]">) {
  const { qrId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!q.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  // HEY-175: unexpected failures only; 401, 402, 404 and 422 are answers.
  const failed = (operation: string) =>
    reportAndRethrow({
      operation,
      severity: "high",
      route: "/api/export/all/[qrId]",
      correlationId: requestIdOf(request.headers),
      tags: { format: q.data.format },
    });
  const qr = await getQrCode(session.user.id, qrId).catch(failed("export.authorize"));
  if (!qr) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canDownload(session.user.id, qr).catch(failed("export.authorize"))))
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  const value = encodedValue(qr);
  // HEY-102: one stored ZIP per set of saved layouts (ids and revisions) and format, delivered through a signed link.
  return deliverPaidFile(
    request,
    {
      userId: session.user.id,
      qrCodeId: qr.id,
      scope: "all",
      revision: qr.layouts.reduce((latest, l) => (l.updatedAt > latest ? l.updatedAt : latest), new Date(0)).toISOString(),
      kind: `all-${q.data.format}`,
      ext: "zip",
      facts: {
        layouts: qr.layouts.map((l) => [l.id, l.updatedAt.toISOString(), l.name]),
        design: qr.layouts.map((l) => l.design),
        value,
        name: qr.name,
      },
    },
    async () => {
      const files: { name: string; data: Uint8Array }[] = [];
      const used = new Set<string>();
      for (const layout of qr.layouts) {
        const L = layout.design.layout;
        if (!layoutCapacity(L, value).ok) continue;
        const file = await renderExport(
          L,
          value,
          q.data.format,
          L.unit === "mm" ? { dpi: PNG_DEFAULTS.dpi } : { scale: PNG_DEFAULTS.scale },
        );
        if (!file.scan.ok) continue;
        let name = downloadFileName(`${qr.name} ${layout.name}`, q.data.format).name;
        for (let i = 2; used.has(name); i++) name = name.replace(/(\.[a-z]+)$/, `-${i}$1`);
        used.add(name);
        files.push({ name, data: new Uint8Array(file.body) });
      }
      if (!files.length) return NextResponse.json({ error: "nothing_to_download" }, { status: 422 });
      return new NextResponse(new Uint8Array(zipFiles(files)), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": downloadFileName(`${qr.name} layouts`, "zip").header,
          "Cache-Control": "private, no-store",
        },
      });
    },
  ).catch(failed("export.deliver"));
}
