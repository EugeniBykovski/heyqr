import "server-only";
import path from "node:path";
import type { Layout } from "@heyqr/qr-core";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import type { PrintSettings } from "@/entities/qr";
import { routing } from "@/i18n/routing";
import { CAPTION_FONT_DIR, downloadFileName, renderExport } from "../qr/export";
import { printPdf, printSpecPdf, type PrintPage } from "./print";

export type PrintFile = "pdf" | "svg" | "spec";

/**
 * One Print Pack file of a print page (design 8.5): the print PDF, the editable SVG at the finished size (no bleed or
 * marks, sRGB with HEX colours, fonts embedded) or the specifications sheet. Shared by a code's own files and the
 * trial's sample files, so both are made by exactly the same code.
 */
export async function printFileResponse(
  kind: PrintFile,
  input: { layout: Layout; page: PrintPage; value: string; settings: PrintSettings; name: string; layoutName: string; locale?: string },
): Promise<NextResponse> {
  const { layout, page, value, settings, name, layoutName } = input;
  if (kind === "pdf")
    return file(await printPdf(layout, page), "application/pdf", downloadFileName(`${name} ${layoutName} print`, "pdf").header);
  if (kind === "svg") {
    const svg = (await renderExport(layout, value, "svg", {})).body
      .toString()
      .replace(
        /^<svg ([^>]*?)width="[^"]*" height="[^"]*"/,
        `<svg $1width="${page.sizes.finished.width}mm" height="${page.sizes.finished.height}mm"`,
      );
    return file(Buffer.from(svg), "image/svg+xml", downloadFileName(`${name} ${layoutName} editable`, "svg").header);
  }
  const locale = routing.locales.find((l) => l === input.locale) ?? routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "print.spec" });
  const keys = ["title", "finished", "page", "bleed", "marks", "qr", "profile", "srgb", "logo", "vector", "colors", "key", "yes", "no"];
  const labels = Object.fromEntries(
    [...keys, ...page.colors.flatMap((c) => c.roles.map((r) => `role_${r}`))].map((k) => [k, t(k as "title")]),
  ) as Parameters<typeof printSpecPdf>[2];
  const spec = await printSpecPdf(
    page,
    {
      name,
      layoutName,
      settings,
      fontFile: path.join(CAPTION_FONT_DIR, "HeyQROnest-Regular.ttf"),
      boldFile: path.join(CAPTION_FONT_DIR, "HeyQROnest-Bold.ttf"),
    },
    labels,
  );
  return file(spec, "application/pdf", downloadFileName(`${name} ${layoutName} specifications`, "pdf").header);
}

function file(body: Buffer, type: string, disposition: string) {
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": disposition, "Cache-Control": "private, no-store" },
  });
}
