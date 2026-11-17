import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { QrPreview } from "@/entities/qr";
import { ExportPanel } from "@/features/checkout";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/server/auth";
import { canDownload } from "@/server/billing/entitlements";
import { encodedValue } from "@/server/qr/export";
import { getQrCode } from "@/server/qr/repository";
import { pricing } from "@/shared/config/pricing";
import { Card } from "@/shared/ui/card";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("export");
  return { title: t("title"), robots: { index: false } };
}

export default async function ExportPage({ params, searchParams }: PageProps<"/[locale]/create/export">) {
  const locale = await resolveLocale(params);
  const query = await searchParams;
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in?next=/dashboard", locale });

  const qrId = typeof query.qr === "string" ? query.qr : undefined;
  const layoutId = typeof query.layout === "string" ? query.layout : undefined;
  const qr = qrId ? await getQrCode(session.user.id, qrId) : undefined;
  const layout = qr?.layouts.find((l) => l.id === layoutId) ?? qr?.layouts[0];
  if (!qr || !layout) notFound();

  const t = await getTranslations("export");
  const entitled = await canDownload(session.user.id, qr);
  const checkout = query.checkout === "success" || query.checkout === "cancelled" ? query.checkout : undefined;
  const cents = qr.model === "dynamic" ? pricing.dynamicMonthlyCents : pricing.staticCents;

  return (
    <section className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-2 md:items-start">
      <Card className="items-center">
        <QrPreview layout={layout.design.layout} value={encodedValue(qr)} label={qr.name} className="w-full max-w-80" />
        <p className="text-h3">{qr.name}</p>
      </Card>
      <Card>
        <h1 className="text-h1">{t("title")}</h1>
        <ExportPanel
          qrCodeId={qr.id}
          layoutId={layout.id}
          model={qr.model}
          entitled={entitled}
          checkout={checkout}
          price={{ cents, currency: pricing.currency }}
        />
      </Card>
    </section>
  );
}
