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
import { loadPrint } from "@/server/print/load";
import { DEFAULT_PRINT_SETTINGS, printSettingsQuery } from "@/entities/qr";
import { Badge } from "@/shared/ui/badge";
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
  // Design 8.6 / 8.7: the Print Pack of this code, for its print (mm) layouts. Unlocked: the three files of each layout at
  // the default print settings, rendered with the same function and key as Print Preview.
  const printLayouts = qr.layouts.filter((l) => l.design.layout.unit === "mm");
  const printPackOpen = entitled && qr.printPackAt !== null;
  const printFiles = printPackOpen
    ? await Promise.all(
        printLayouts.map(async (l) => {
          const loaded = await loadPrint(user.id, l.id, {});
          const key = loaded.ok ? loaded.ctx.page.renderKey : null;
          const q = (file: string) =>
            `/api/print/files/${l.id}?file=${file}&key=${key ?? ""}&nav=1&qr=${qr.id}&${printSettingsQuery(DEFAULT_PRINT_SETTINGS)}`;
          return { layout: l, key, pdf: q("pdf"), svg: q("svg"), spec: q("spec") };
        }),
      )
    : [];
  const tp = await getTranslations("print");
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
        <section aria-labelledby="print-pack" className="flex flex-col gap-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="print-pack" className="text-h2">
              {tp("pack.title")}
            </h2>
            <Badge variant={printPackOpen ? "success" : "neutral"}>{printPackOpen ? tp("unlocked") : tp("locked")}</Badge>
          </div>
          {printLayouts.length === 0 ? (
            <Card>
              <p className="text-secondary-foreground">{tp("notPrint.text")}</p>
            </Card>
          ) : printPackOpen ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {printFiles.map((f) => (
                <li key={f.layout.id}>
                  <Card className="gap-3">
                    <CardTitle>{f.layout.name}</CardTitle>
                    {(
                      [
                        ["pdf", tp("files.pdf")],
                        ["svg", tp("files.svg")],
                        ["spec", tp("files.spec")],
                      ] as const
                    ).map(([file, label]) => (
                      <a
                        key={file}
                        href={f[file]}
                        className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-[0.875rem] font-semibold hover:border-border-hover"
                      >
                        <DownloadIcon aria-hidden className="size-4 shrink-0" />
                        {label}
                      </a>
                    ))}
                    <span className="text-caption text-muted-foreground">{tp("pack.defaults")}</span>
                    <Button asChild size="sm" className="self-start">
                      <Link href={`/print?qr=${qr.id}&layout=${f.layout.id}&from=details`}>{tp("pack.open")}</Link>
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="gap-3">
              <p className="text-secondary-foreground">{entitled ? tp("pack.add") : tp("unlock.needCode")}</p>
              <div className="flex flex-wrap gap-2">
                {printLayouts.map((l) => (
                  <Button key={l.id} asChild variant={entitled ? "primary" : "secondary"} size="sm">
                    <Link href={`/print?qr=${qr.id}&layout=${l.id}&from=details`}>{tp("pack.preview", { layout: l.name })}</Link>
                  </Button>
                ))}
              </div>
            </Card>
          )}
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
