import { formatMoney, priceSheet } from "@/shared/config/catalog";
import { layoutGeometry, type QrContent } from "@heyqr/qr-core";
import { ArrowLeftIcon, CheckIcon, DownloadIcon, FileTextIcon, LinkIcon, LockIcon, PrinterIcon, RulerIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { env } from "@/env";
import { DEFAULT_PRINT_SETTINGS, printSettingsQuery, QrPreview } from "@/entities/qr";
import { CopyButton } from "@/features/copy-to-clipboard";
import { DeleteLayoutButton, DifferentContent, NewLayoutButton, RenameTitle, UseIncludedPrintPack } from "@/features/qr-details";
import { DestinationForm, DestinationHistory } from "@/features/qr-destination";
import { destinationHistory } from "@/server/qr/destination";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireAccount } from "../../../require-account";
import { getSession } from "@/server/auth";
import { getCurrency } from "@/server/currency";
import { accountUsage } from "@/server/billing/allowances";
import { canDownload, printPackForSale, userTrial } from "@/server/billing/entitlements";
import { db } from "@/server/db";
import { loadPrint } from "@/server/print/load";
import { encodedValue } from "@/server/qr/export";
import { dailyScans, getQrCode } from "@/server/qr/repository";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardTitle } from "@/shared/ui/card";
import { ScansChart } from "@/widgets/scans-chart";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/qr/[id]">): Promise<Metadata> {
  const { id } = await params;
  // Guests are redirected to sign-in by the page; their metadata reveals nothing about the code.
  const session = await getSession();
  const qr = session ? await getQrCode(session.user.id, id) : null;
  return { title: qr?.name ?? "QR", robots: { index: false } };
}

/** What a static code holds, in one line (design 4.3 "Content · Fixed in the code"). */
function contentLine(c: QrContent): string {
  switch (c.type) {
    case "website":
      return c.url.replace(/^https?:\/\//i, "");
    case "text":
      return c.text;
    case "wifi":
      return c.ssid;
    case "contact":
      return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email || c.phone || "";
    case "email":
      return c.to;
    case "phone":
    case "sms":
      return c.number;
    case "location":
      return c.name || c.address;
    case "event":
      return c.title;
  }
}

/*
 * Design 4.3–4.7 QR details and 8.6–8.7 Print Pack. Static: what the code holds and what's included. Dynamic: the
 * permanent short link, its destination (view / edit / saved) and scans. Print Pack: locked (Print Preview first, then
 * the add-on) or its files. Layouts: each with Edit, its downloads, and Print Preview for print (mm) layouts, or
 * "Set up for print" for screen layouts, which opens Edit design → Size and returns to Print Preview once saved in mm.
 */
export default async function QrDetailPage({ params, searchParams }: PageProps<"/[locale]/dashboard/qr/[id]">) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const user = await requireAccount(locale, `/dashboard/qr/${encodeURIComponent(id)}`, await searchParams);
  const qr = await getQrCode(user.id, id);
  if (!qr) notFound();
  const [t, tl, tp, tTypes, tDash, , entitled, scans, phase, usage] = await Promise.all([
    getTranslations("qr"),
    getTranslations("qr.details"),
    getTranslations("print"),
    getTranslations("contentTypes"),
    getTranslations("dashboard"),
    getFormatter(),
    canDownload(user.id, qr),
    qr.model === "dynamic" ? dailyScans(qr.id) : Promise.resolve(null),
    userTrial(user.id),
    accountUsage(db, user.id),
  ]);
  // HEY-125: the owner's recorded destination changes (the code was loaded for this owner above).
  const history = qr.model === "dynamic" ? await destinationHistory(db, user.id, qr.id) : [];
  const value = encodedValue(qr);
  const shortLink = qr.shortCode ? `${env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "")}/${qr.shortCode}` : null;
  const shortShown = shortLink?.replace(/^https?:\/\//, "") ?? "";
  // The same status My QR codes shows (a trial test code after its trial is Paused).
  const trialLive = phase.state === "active" || phase.state === "ending" || phase.state === "upgraded";
  const live = qr.status === "active" && (!qr.isTrial || trialLive);
  const status = qr.status === "active" ? (qr.model === "static" ? "purchased" : live ? "active" : "paused") : qr.status;

  const printLayouts = qr.layouts.filter((l) => l.design.layout.unit === "mm");
  const printPackOpen = entitled && qr.printPackAt !== null;
  const forSale = printPackForSale(await getCurrency());
  // HEY-105 design 8.4: the plan's included Print Packs left this month (Studio), the same allowance Export uses.
  const includedLeft = usage.packs.limit > 0 ? Math.max(0, usage.packs.limit - usage.packs.used) : 0;
  const planName = usage.plan ? tp(`plan.${usage.plan.id}`) : "";
  const firstPrint = printLayouts[0];
  const printHref = (layoutId: string) => `/print?qr=${qr.id}&layout=${layoutId}&from=details`;
  const setupHref = (layoutId: string) => `/edit/${qr.id}?layout=${layoutId}&group=size&next=print`;
  const printFiles =
    printPackOpen && firstPrint
      ? await (async () => {
          const loaded = await loadPrint(user.id, firstPrint.id, {});
          const key = loaded.ok ? loaded.ctx.page.renderKey : "";
          const sizes = loaded.ok ? loaded.ctx.page.sizes : null;
          const q = (file: string) =>
            `/api/print/files/${firstPrint.id}?file=${file}&key=${key}&nav=1&qr=${qr.id}&${printSettingsQuery(DEFAULT_PRINT_SETTINGS)}`;
          return [
            {
              file: "pdf",
              label: tp("files.pdfTitle"),
              meta: sizes ? tp("files.pdfSub", { w: sizes.page.width, h: sizes.page.height }) : "",
              href: q("pdf"),
            },
            {
              file: "svg",
              label: tp("files.svgTitle"),
              meta: sizes ? tp("files.svgSub", { w: sizes.finished.width, h: sizes.finished.height }) : "",
              href: q("svg"),
            },
            { file: "spec", label: tp("files.specTitle"), meta: tp("files.specSub"), href: q("spec") },
          ];
        })()
      : [];
  const dims = (l: (typeof qr.layouts)[number]) => {
    const L = l.design.layout;
    const g = layoutGeometry(L);
    const r = (v: number) => (L.unit === "mm" ? Math.round(v * 10) / 10 : Math.round(v));
    return L.preset === "qr" ? tl("dimsSquare", { size: `${r(g.width)} ${L.unit}` }) : `${r(g.width)} × ${r(g.height)} ${L.unit}`;
  };
  const currency = await getCurrency();
  const ppCents = priceSheet(currency).printPack;
  const amount = formatMoney(ppCents, currency);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/dashboard">
          <ArrowLeftIcon aria-hidden />
          {tl("back")}
        </Link>
      </Button>
      <header>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge>{tTypes(qr.content.type)}</Badge>
            <Badge variant={qr.model === "dynamic" ? "info" : "neutral"}>{tDash(`model.${qr.model}`)}</Badge>
            <Badge variant={status === "active" || status === "purchased" ? "success" : status === "paused" ? "warning" : "neutral"}>
              {tDash(`status.${status}`)}
            </Badge>
          </div>
          <RenameTitle
            qrCodeId={qr.id}
            name={qr.name}
            actions={
              qr.layouts[0] ? (
                <NewLayoutButton
                  look="button"
                  qrCodeId={qr.id}
                  codeName={qr.name}
                  sourceLayoutId={qr.layouts[0].id}
                  nextNumber={qr.layouts.length + 1}
                />
              ) : null
            }
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
        <section className="flex min-w-0 flex-col gap-5">
          {qr.model === "dynamic" ? (
            <>
              <Card className="gap-5">
                {shortLink ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>{t("shortLink")}</CardTitle>
                      <Badge variant="dark">{tl("permanent")}</Badge>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <LinkIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 grow truncate font-mono text-[0.875rem]">{shortShown}</span>
                      <CopyButton value={shortLink} label={t("copy")} copiedLabel={t("copied")} />
                    </div>
                    <p className="text-caption text-muted-foreground">{tl("shortNote")}</p>
                  </div>
                ) : (
                  <p className="text-secondary-foreground">{tl("noShortLink")}</p>
                )}
                {shortLink ? (
                  <>
                    <hr className="border-border" />
                    <DestinationForm
                      qrCodeId={qr.id}
                      destination={qr.destination ?? ""}
                      shortLink={shortShown}
                      previous={qr.previousDestination}
                      changedAt={qr.destinationChangedAt?.toISOString() ?? null}
                    />
                    <DestinationHistory entries={history} />
                  </>
                ) : null}
              </Card>
              {scans ? (
                <Card>
                  <ScansChart days={scans} />
                </Card>
              ) : null}
            </>
          ) : (
            <Card className="gap-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{tl("content")}</CardTitle>
                <Badge>{tl("fixed")}</Badge>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border px-3.5 py-3">
                <span className="text-caption text-muted-foreground">
                  {qr.content.type === "website" ? tl("opens") : tTypes(qr.content.type)}
                </span>
                <span className="text-body font-semibold break-all">
                  {qr.content.type === "website" ? qr.content.url : contentLine(qr.content)}
                </span>
              </div>
              <p className="text-caption text-secondary-foreground">{tl("staticNote")}</p>
              <DifferentContent price={formatMoney(priceSheet(currency).single, currency)} />
              {entitled ? (
                <ul className="flex flex-col gap-1.5 text-[0.875rem]">
                  {[tl("incl.files"), tl("incl.layouts")].map((x) => (
                    <li key={x} className="flex items-start gap-2">
                      <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      {x}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          )}

          <Card className="gap-3" aria-labelledby="print-pack">
            <div className="flex items-center justify-between gap-2">
              <h2 id="print-pack" className="text-h3">
                {tp("pack.title")}
              </h2>
              <Badge variant={printPackOpen ? "success" : "neutral"}>{printPackOpen ? tl("ppUnlocked") : tl("ppLocked")}</Badge>
            </div>
            {!firstPrint ? (
              <>
                <p className="text-caption text-secondary-foreground">{tl("pack.needsMm")}</p>
                {qr.layouts[0] ? (
                  <Button asChild className="self-start">
                    <Link href={setupHref(qr.layouts[0].id)}>
                      <RulerIcon aria-hidden />
                      {tl("setupPrint")}
                    </Link>
                  </Button>
                ) : null}
              </>
            ) : printPackOpen ? (
              <>
                <ul className="flex flex-col gap-2">
                  {printFiles.map((f) => (
                    <li key={f.file} className="flex min-w-0 items-center gap-3 rounded-lg bg-subtle px-3 py-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface">
                        <FileTextIcon aria-hidden className="size-4" />
                      </span>
                      <span className="flex min-w-0 grow flex-col">
                        <span className="text-label">{f.label}</span>
                        <span className="truncate text-caption text-muted-foreground">{f.meta}</span>
                      </span>
                      <Button asChild size="sm">
                        <a href={f.href}>
                          <DownloadIcon aria-hidden />
                          <span className="max-sm:sr-only">{t("download")}</span>
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Button asChild size="sm">
                    <Link href={printHref(firstPrint.id)}>{tp("pack.open")}</Link>
                  </Button>
                  <span className="text-caption text-muted-foreground">{tl("pack.repeat", { layout: firstPrint.name })}</span>
                </div>
              </>
            ) : entitled && includedLeft > 0 ? (
              <>
                <p className="text-caption text-secondary-foreground">{tl("pack.what")}</p>
                <UseIncludedPrintPack qrCodeId={qr.id} />
                <span className="text-caption text-muted-foreground">
                  {tl("pack.includedSub", { left: includedLeft, limit: usage.packs.limit, plan: planName })}
                </span>
                <Link href={printHref(firstPrint.id)} className="self-start text-[0.875rem] font-semibold underline underline-offset-3">
                  {tl("pack.inspect")}
                </Link>
              </>
            ) : (
              <>
                <p className="text-caption text-secondary-foreground">{tl("pack.what")}</p>
                <Button asChild variant="primary" className="w-full">
                  <Link href={printHref(firstPrint.id)}>
                    <PrinterIcon aria-hidden />
                    {entitled && forSale ? tl("pack.add", { price: amount }) : tp("pack.open")}
                  </Link>
                </Button>
                <span className="text-caption text-muted-foreground">
                  {!entitled ? tp("unlock.needCode") : forSale ? tl("pack.addSub") : tl("pack.notForSale")}
                </span>
              </>
            )}
          </Card>
        </section>

        <section aria-labelledby="layouts" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="layouts" className="text-h3">
              {t("layouts")}{" "}
              <span className="text-caption font-normal text-muted-foreground">· {tl("layoutsCount", { n: qr.layouts.length })}</span>
            </h2>
            {entitled ? (
              <Button asChild size="sm">
                <a href={`/api/export/all/${qr.id}?format=png`} download>
                  <DownloadIcon aria-hidden />
                  {tl("downloadAll")}
                </a>
              </Button>
            ) : null}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {qr.layouts.map((layout) => {
              const mm = layout.design.layout.unit === "mm";
              return (
                <li key={layout.id} className="min-w-0">
                  <Card className="h-full gap-3 p-3 sm:p-3">
                    <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-stage p-3">
                      <QrPreview layout={layout.design.layout} value={value} label={layout.name} className="size-full" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-label" title={layout.name}>
                        {layout.name}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {dims(layout)} · {mm ? tl("print") : tl("screen")}
                      </span>
                    </div>
                    {/* HEY-65: on a narrow card (two per row at 390 px) the icon actions wrap under Edit instead of
                        running past the card's edge. */}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" className="min-w-18 grow">
                        <Link href={`/edit/${qr.id}?layout=${layout.id}`}>{tl("edit")}</Link>
                      </Button>
                      {mm ? (
                        <Button asChild size="icon-sm" aria-label={tl("printPreview", { name: layout.name })}>
                          <Link href={printHref(layout.id)}>
                            <PrinterIcon aria-hidden />
                          </Link>
                        </Button>
                      ) : null}
                      {/* HEY-105 design 3.11: an unlocked code downloads each layout as PNG or SVG through Export, with
                          the exact code, layout and format (Download again there; access is checked on each download). */}
                      {entitled ? (
                        (["png", "svg"] as const).map((f) => (
                          <Button
                            key={f}
                            asChild
                            size="sm"
                            variant="secondary"
                            aria-label={tl("downloadFormat", { format: f.toUpperCase(), name: layout.name })}
                          >
                            <Link href={`/create/export?qr=${qr.id}&layout=${layout.id}&format=${f}`}>
                              <DownloadIcon aria-hidden />
                              {f.toUpperCase()}
                            </Link>
                          </Button>
                        ))
                      ) : (
                        <Button asChild size="icon-sm" variant="primary" aria-label={t("buy")}>
                          <Link href={`/create/export?qr=${qr.id}&layout=${layout.id}`}>
                            <LockIcon aria-hidden />
                          </Link>
                        </Button>
                      )}
                      <DeleteLayoutButton qrCodeId={qr.id} layoutId={layout.id} name={layout.name} canDelete={qr.layouts.length > 1} />
                    </div>
                    {mm ? null : (
                      <Link
                        href={setupHref(layout.id)}
                        className="inline-flex min-h-8 items-center gap-1.5 self-start text-[0.8125rem] font-semibold text-foreground underline underline-offset-3"
                      >
                        <RulerIcon aria-hidden className="size-4" />
                        {tl("setupPrint")}
                      </Link>
                    )}
                  </Card>
                </li>
              );
            })}
            {qr.layouts[0] ? (
              <li className="min-w-0">
                <NewLayoutButton
                  look="card"
                  qrCodeId={qr.id}
                  codeName={qr.name}
                  sourceLayoutId={qr.layouts[0].id}
                  nextNumber={qr.layouts.length + 1}
                />
              </li>
            ) : null}
          </ul>
          <p className="text-caption text-muted-foreground">{qr.model === "dynamic" ? tl("layoutNoteDynamic") : tl("layoutNoteStatic")}</p>
        </section>
      </div>
    </>
  );
}
