import { ArrowLeftIcon, DownloadIcon, LockIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { QrPreview } from "@/entities/qr";
import { CopyButton } from "@/features/copy-to-clipboard";
import { DestinationForm } from "@/features/qr-destination";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/server/auth";
import { canDownload } from "@/server/billing/entitlements";
import { encodedValue } from "@/server/qr/export";
import { dailyScans, getQrCode } from "@/server/qr/repository";
import { Button } from "@/shared/ui/button";
import { Card, CardTitle } from "@/shared/ui/card";
import { ScansChart } from "@/widgets/scans-chart";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/qr/[id]">): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser();
  const qr = await getQrCode(user.id, id);
  return { title: qr?.name ?? "QR", robots: { index: false } };
}

export default async function QrDetailPage({ params }: PageProps<"/[locale]/dashboard/qr/[id]">) {
  await resolveLocale(params);
  const { id } = await params;
  const user = await requireUser();
  const qr = await getQrCode(user.id, id);
  if (!qr) notFound();
  const [t, entitled, scans] = await Promise.all([
    getTranslations("qr"),
    canDownload(user.id, qr),
    qr.model === "dynamic" ? dailyScans(qr.id) : Promise.resolve(null),
  ]);
  const value = encodedValue(qr);
  const shortLink = qr.shortCode ? `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${qr.shortCode}` : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/dashboard">
          <ArrowLeftIcon aria-hidden />
          {t("back")}
        </Link>
      </Button>
      <h1 className="text-h1">{qr.name}</h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="layouts" className="flex flex-col gap-4">
          <h2 id="layouts" className="text-h2">
            {t("layouts")}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {qr.layouts.map((layout) => (
              <li key={layout.id}>
                <Card>
                  <div className="grid aspect-square place-items-center rounded-lg bg-stage p-4">
                    <QrPreview layout={layout.design.layout} value={value} label={layout.name} className="size-full" />
                  </div>
                  <CardTitle>{layout.name}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {/* HEY-45: opens this exact layout in the Design editor. */}
                    <Button asChild size="sm">
                      <Link href={`/edit/${qr.id}?layout=${layout.id}`}>
                        <PencilIcon aria-hidden />
                        {t("editDesign")}
                      </Link>
                    </Button>
                    {entitled ? (
                      <>
                        {(["png", "svg"] as const).map((f) => (
                          <Button key={f} asChild size="sm">
                            <a href={`/api/export/${layout.id}?format=${f}`} download>
                              <DownloadIcon aria-hidden />
                              {f.toUpperCase()}
                            </a>
                          </Button>
                        ))}
                      </>
                    ) : (
                      <Button asChild variant="primary" size="sm">
                        <Link href={`/create/export?qr=${qr.id}&layout=${layout.id}`}>
                          <LockIcon aria-hidden />
                          {t("buy")}
                        </Link>
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
        {qr.model === "dynamic" ? (
          <section className="flex flex-col gap-4">
            {shortLink ? (
              <Card>
                <CardTitle>{t("shortLink")}</CardTitle>
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded-sm bg-subtle px-2 py-1 font-mono text-body">{shortLink}</code>
                  <CopyButton value={shortLink} label={t("copy")} copiedLabel={t("copied")} />
                </div>
              </Card>
            ) : null}
            <Card>
              <DestinationForm qrCodeId={qr.id} destination={qr.destination ?? ""} />
            </Card>
            {scans ? (
              <Card>
                <ScansChart days={scans} />
              </Card>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
