import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/auth";
import { readPrintSettings, unsupportedProfile } from "@/entities/qr";
import { env } from "@/env";
import { loadPrint } from "@/server/print/load";
import { printPage } from "@/server/print/print";
import { samplePrint } from "@/server/print/sample";
import { withEmbeddedImages } from "@/server/qr/export";

const sampleBody = z.object({ sample: z.literal(true), settings: z.record(z.string(), z.unknown()).default({}) });
const body = z.object({ layoutId: z.string().min(1).max(64), settings: z.record(z.string(), z.unknown()).default({}) });

/**
 * Design 8.1 / Handoff §4 POST /api/print/preview: the print page of the owner's layout with these settings, its sizes,
 * colours, logo resolution, warnings and render key. Available before the Print Pack is bought (inspect first);
 * the files themselves come only from /api/print/files.
 */
export async function POST(request: NextRequest) {
  const json: unknown = await request.json().catch(() => null);
  // Design 1.1 / 9.1: the public sample (a fixed demo QR) can be inspected by anyone; nothing of an account is read.
  const sample = sampleBody.safeParse(json);
  if (sample.success) {
    if (unsupportedProfile(sample.data.settings)) return NextResponse.json({ error: "unsupported_profile" }, { status: 422 });
    const base = samplePrint(env.NEXT_PUBLIC_APP_URL);
    const settings = readPrintSettings(sample.data.settings, base.layout);
    const layout = await withEmbeddedImages(base.layout);
    const page = printPage(layout, base.value, settings, { layoutId: "sample", revision: "v1" });
    return NextResponse.json(
      {
        svg: page.svg,
        sizes: page.sizes,
        colors: page.colors,
        logo: page.logo,
        warnings: page.warnings,
        renderKey: page.renderKey,
        scanOk: page.scanOk,
        settings,
        entitled: false,
        unlocked: false,
        forSale: false,
      },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await loadPrint(session.user.id, parsed.data.layoutId, parsed.data.settings);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 422 });
  const { page, settings, entitled, unlocked, forSale } = result.ctx;
  return NextResponse.json(
    {
      svg: page.svg,
      sizes: page.sizes,
      colors: page.colors,
      logo: page.logo,
      warnings: page.warnings,
      renderKey: page.renderKey,
      scanOk: page.scanOk,
      settings,
      entitled,
      unlocked,
      forSale,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
