import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DEFAULT_PRINT_SETTINGS, designToLayout } from "@/entities/qr";
import { PrintPreview } from "@/features/print-preview";
import { resolveLocale } from "@/i18n/server";
import { getCurrency } from "@/server/currency";
import { SAMPLE_PRINT_DESIGN } from "@/server/print/sample";
import { priceSheet } from "@/shared/config/catalog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("print.sample");
  return { title: t("pageTitle") };
}

/*
 * Design 1.1 "Open Print Preview" from Home: Print Preview of the public demo QR (Little Fern Coffee brand card), the
 * same page and specifications a Print Pack is made from. No account data; no purchase or files on this page.
 */
export default async function PrintSamplePage({ params }: PageProps<"/[locale]/print/sample">) {
  await resolveLocale(params);
  const [t, currency] = await Promise.all([getTranslations("print.sample"), getCurrency()]);
  return (
    <PrintPreview
      sample
      qrCodeId="sample"
      layoutId="sample"
      layout={designToLayout(SAMPLE_PRINT_DESIGN)}
      name={t("name")}
      layoutName={t("layout")}
      initial={DEFAULT_PRINT_SETTINGS}
      price={{ cents: priceSheet(currency).printPack ?? 0, currency }}
      back={{ href: "/", label: t("back") }}
      designHref="/create"
      entitled={false}
      forSale={false}
    />
  );
}
