import { priceSheet } from "@/shared/config/catalog";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readPrintSettings } from "@/entities/qr";
import { PrintPreview } from "@/features/print-preview";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { getSession } from "@/server/auth";
import { getCurrency } from "@/server/currency";
import { canDownload, printPackForSale } from "@/server/billing/entitlements";
import { getQrCode } from "@/server/qr/repository";
import { Button } from "@/shared/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("print");
  return { title: t("title"), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/*
 * Design 8.1–8.5 "Print Preview" for one layout of the user's own code: /print?qr=…&layout=…[&from=details|export].
 * Print settings live in the URL, so checkout and a stale download return to the same screen and settings.
 */
export default async function PrintPage({ params, searchParams }: PageProps<"/[locale]/print">) {
  const locale = await resolveLocale(params);
  const query = await searchParams;
  const qrId = one(query.qr);
  const layoutId = one(query.layout);
  const session = await getSession();
  if (!session) {
    const here = `/print?${new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString()}`;
    return redirect({ href: `/sign-in?next=${encodeURIComponent(here)}`, locale });
  }
  const qr = qrId ? await getQrCode(session.user.id, qrId) : undefined;
  const layout = qr?.layouts.find((l) => l.id === layoutId) ?? qr?.layouts[0];
  if (!qr || !layout) notFound();
  const t = await getTranslations("print");
  const from = one(query.from) === "export" ? "export" : "details";
  const back = {
    href: from === "export" ? `/create/export?qr=${qr.id}&layout=${layout.id}` : `/dashboard/qr/${qr.id}`,
    label: t(`back.${from}`),
  };
  const designHref = `/edit/${qr.id}?layout=${layout.id}`;
  const saved = layout.design.layout;

  if (saved.unit !== "mm")
    return (
      <main className="mx-auto flex max-w-measure flex-col items-start gap-4 px-4 py-14 sm:px-6">
        <h1 className="text-h1">{t("notPrint.title")}</h1>
        <p className="text-secondary-foreground">{t("notPrint.text")}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link href={`/edit/${qr.id}?layout=${layout.id}&group=size&next=print`}>{t("notPrint.action")}</Link>
          </Button>
          <Button asChild>
            <Link href={back.href}>{back.label}</Link>
          </Button>
        </div>
      </main>
    );

  const checkout = query.checkout === "success" || query.checkout === "cancelled" ? query.checkout : undefined;
  const currency = await getCurrency();
  return (
    <PrintPreview
      key={`${qr.id}:${layout.id}`}
      qrCodeId={qr.id}
      layoutId={layout.id}
      layout={saved}
      name={qr.name}
      layoutName={layout.name}
      initial={readPrintSettings(query as Record<string, unknown>, saved)}
      price={{ cents: priceSheet(currency).printPack ?? 0, currency }}
      back={back}
      designHref={designHref}
      checkout={checkout}
      stale={one(query.stale) === "1"}
      entitled={await canDownload(session.user.id, qr)}
      forSale={printPackForSale(currency)}
    />
  );
}
