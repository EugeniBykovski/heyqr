import { layoutCapacity, PNG_DEFAULTS } from "@heyqr/qr-core";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { canDownload } from "@/server/billing/entitlements";
import { downloadFileName, encodedValue, renderExport } from "@/server/qr/export";
import { getQrCode } from "@/server/qr/repository";
import { zipFiles } from "@/server/qr/zip";

const query = z.object({ format: z.enum(["png", "svg"]).default("png") });

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
  const qr = await getQrCode(session.user.id, qrId);
  if (!qr) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canDownload(session.user.id, qr))) return NextResponse.json({ error: "payment_required" }, { status: 402 });
  const value = encodedValue(qr);
  const files: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  for (const layout of qr.layouts) {
    const L = layout.design.layout;
    if (!layoutCapacity(L, value).ok) continue;
    const file = await renderExport(L, value, q.data.format, L.unit === "mm" ? { dpi: PNG_DEFAULTS.dpi } : { scale: PNG_DEFAULTS.scale });
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
}
