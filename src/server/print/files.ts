import "server-only";
import path from "node:path";
import type { Layout } from "@heyqr/qr-core";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { MIN_PRINT_QR_MM, type PrintSettings } from "@/entities/qr";
import { routing } from "@/i18n/routing";
import { CAPTION_FONT_DIR, downloadFileName, renderExport } from "../qr/export";
import type { CmykConverter } from "./cmyk";
import { groupedPrintSvg, printPdf, printSpecPdf, type PrintPage } from "./print";

export type PrintFile = "pdf" | "svg" | "spec";

/**
 * One Print Pack file of a print page (design 8.5): the print PDF, the editable SVG at the finished size (no bleed or
 * marks, sRGB with HEX colours, fonts embedded) or the specifications sheet. Shared by a code's own files and the
 * trial's sample files, so both are made by exactly the same code.
 */
export async function printFileResponse(
  kind: PrintFile,
  input: {
    layout: Layout;
    page: PrintPage;
    /** HEY-188: the selected CMYK profile's converter (the print PDF in CMYK); absent or null for sRGB. */
    cmyk?: CmykConverter | null;
    value: string;
    settings: PrintSettings;
    name: string;
    layoutName: string;
    locale?: string;
    /** HEY-196: the saved layout revision the page was made from, printed on the specifications sheet. */
    revision?: string;
  },
): Promise<NextResponse> {
  const { layout, page, value, settings, name, layoutName } = input;
  const cmyk = input.cmyk ?? undefined;
  // HEY-69: the finished size in every file name, so proofs at two sizes never overwrite each other.
  const size = `${page.sizes.finished.width}x${page.sizes.finished.height}mm`;
  if (kind === "pdf")
    return file(
      await printPdf(layout, page, settings.bleed, cmyk),
      "application/pdf",
      // HEY-188: a CMYK file names its profile too, so proofs for two presses never overwrite each other.
      downloadFileName(`${name} ${layoutName} print ${size}${cmyk ? ` ${settings.profile}` : ""}`, "pdf").header,
    );
  if (kind === "svg") {
    // HEY-196: in mm at the finished size, each part of the layout in its own named group.
    const svg = groupedPrintSvg(
      (await renderExport(layout, value, "svg", {})).body
        .toString()
        .replace(
          /^<svg ([^>]*?)width="[^"]*" height="[^"]*"/,
          `<svg $1width="${page.sizes.finished.width}mm" height="${page.sizes.finished.height}mm"`,
        ),
    );
    return file(Buffer.from(svg), "image/svg+xml", downloadFileName(`${name} ${layoutName} editable ${size}`, "svg").header);
  }
  const locale = routing.locales.find((l) => l === input.locale) ?? routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "print.spec" });
  const keys = [
    ...["title", "finished", "page", "bleed", "safe", "marks", "qr", "profile", "srgb", "standard", "standardValue", "logo", "vector"],
    ...["warnings", "none", "revision", "colors", "key", "yes", "no"],
  ];
  const labels = Object.fromEntries(
    [...keys, ...page.colors.flatMap((c) => c.roles.map((r) => `role_${r}`))].map((k) => [k, t(k as "title")]),
  ) as Parameters<typeof printSpecPdf>[2];
  // HEY-188: a CMYK file's sheet names its profile and ICC file, and lists each colour's CMYK values too.
  if (cmyk) {
    const tp = await getTranslations({ locale, namespace: "print.profiles" });
    labels.srgb = `${tp(settings.profile)} · ${cmyk.description}`;
    labels.colors = t("colorsCmyk");
  }
  // HEY-196: the same warnings as Print Preview, from the same page (upscaling a logo never clears its warning).
  const warnings = page.warnings.map((w) =>
    w.code === "logo_low_ppi" ? t("warnLogo", { ppi: w.ppi, px: w.needPx }) : t("warnQr", { mm: w.qrMm, min: MIN_PRINT_QR_MM }),
  );
  const spec = await printSpecPdf(
    page,
    {
      name,
      layoutName,
      settings,
      fontFile: path.join(CAPTION_FONT_DIR, "HeyQROnest-Regular.ttf"),
      boldFile: path.join(CAPTION_FONT_DIR, "HeyQROnest-Bold.ttf"),
      revision: input.revision,
      warnings,
    },
    labels,
  );
  return file(spec, "application/pdf", downloadFileName(`${name} ${layoutName} specifications ${size}`, "pdf").header);
}

function file(body: Buffer, type: string, disposition: string) {
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": disposition, "Cache-Control": "private, no-store" },
  });
}
