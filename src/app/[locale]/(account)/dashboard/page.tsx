import { QrCodeIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireAccount } from "../require-account";
import { userTrial } from "@/server/billing/entitlements";
import { TrialBar } from "@/widgets/trial";
import { encodedValue } from "@/server/qr/export";
import { listQrCodes } from "@/server/qr/repository";
import { Button } from "@/shared/ui/button";
import { segmentedOption, SegmentedTrack } from "@/shared/ui/segmented";
import { env } from "@/env";
import { accountUsage } from "@/server/billing/allowances";
import { getCurrency } from "@/server/currency";
import { db } from "@/server/db";
import { priceSheet } from "@/shared/config/catalog";
import { UsageTiles } from "@/widgets/usage";
import { LibraryHeader, type LibraryItem, QrLibraryManager, type QrCardStatus } from "@/widgets/qr-library";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

const FILTERS = ["all", "static", "dynamic"] as const;
type Filter = (typeof FILTERS)[number];

export default async function DashboardPage({ params, searchParams }: PageProps<"/[locale]/dashboard">) {
  const locale = await resolveLocale(params);
  const query = await searchParams;
  const user = await requireAccount(locale, "/dashboard", query);
  const [t, tTypes, format] = await Promise.all([getTranslations("dashboard"), getTranslations("contentTypes"), getFormatter()]);
  const [codes, phase, usage, currency] = await Promise.all([
    listQrCodes(user.id),
    userTrial(user.id),
    accountUsage(db, user.id),
    getCurrency(),
  ]);
  // Design 9.5: the trial's state and its one live test slot, apart from anything monthly.
  // A trial test code after the trial (no plan) keeps its row but its redirect is paused: it shows as Paused.
  const trialLive = phase.state === "active" || phase.state === "ending" || phase.state === "upgraded";
  const live = (c: (typeof codes)[number]) => c.status === "active" && (!c.isTrial || trialLive);
  const trialBar = <TrialBar phase={phase} showUsage={phase.state !== "expired"} slotUsed={codes.some((c) => c.isTrial && live(c))} />;
  const filter: Filter = FILTERS.find((f) => f === query.filter) ?? "all";
  const counts = {
    all: codes.length,
    static: codes.filter((c) => c.model === "static").length,
    dynamic: codes.filter((c) => c.model === "dynamic").length,
  };
  const dynamicActive = codes.filter((c) => c.model === "dynamic" && live(c)).length;
  const visible = filter === "all" ? codes : codes.filter((c) => c.model === filter);

  const header = (
    <LibraryHeader
      title={t("title")}
      createLabel={t("new")}
      sub={<p>{codes.length ? t("sub", { count: codes.length, dynamic: dynamicActive }) : t("subEmpty")}</p>}
    />
  );

  if (codes.length === 0)
    return (
      <div className="flex flex-col gap-6">
        {trialBar}
        <div>
          {header}
          <div className="flex flex-col items-center gap-3.5 rounded-2xl border border-dashed border-input bg-surface px-5 py-12 text-center">
            <span className="grid size-28 place-items-center rounded-xl bg-subtle text-muted-foreground">
              <QrCodeIcon aria-hidden className="size-10" strokeWidth={1.5} />
            </span>
            <h2 className="text-h2">{t("empty.title")}</h2>
            <p className="max-w-measure text-secondary-foreground">{t("empty.text")}</p>
            <Button asChild variant="primary" size="lg">
              <Link href="/create">{t("empty.cta")}</Link>
            </Button>
          </div>
        </div>
      </div>
    );

  const shortBase = env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "");
  const items: LibraryItem[] = visible.map((qr) => {
    const layout = qr.layouts[0];
    const paid = qr.model === "dynamic" ? live(qr) : qr.purchasedAt !== null;
    const status: QrCardStatus =
      qr.status === "active" ? (qr.model === "static" ? "purchased" : live(qr) ? "active" : "paused") : qr.status;
    return {
      id: qr.id,
      name: qr.name,
      href: `/dashboard/qr/${qr.id}`,
      // Edit design opens the first layout, the one shown here (HEY-45).
      editHref: layout ? `/edit/${qr.id}?layout=${layout.id}` : `/edit/${qr.id}`,
      exportHref: layout ? `/create/export?qr=${qr.id}&layout=${layout.id}` : undefined,
      layout: layout?.design.layout,
      value: encodedValue(qr),
      typeLabel: tTypes(qr.content.type),
      model: qr.model,
      modelLabel: t(`model.${qr.model}`),
      status,
      statusLabel: t(`status.${status}`),
      meta: t("updated", { date: format.dateTime(qr.updatedAt, { dateStyle: "medium" }) }),
      paid,
      printPackLabel: qr.printPackAt ? t("printPack") : undefined,
      shortLink: qr.shortCode ? `${shortBase.replace(/^https?:\/\//, "")}/${qr.shortCode}` : undefined,
      labels: {
        open: t("open", { name: qr.name }),
        edit: t("actions.edit"),
        download: t("actions.download"),
        buy: t("actions.buy"),
      },
    };
  });

  return (
    <>
      {usage.plan ? null : trialBar}
      <QrLibraryManager
        title={t("title")}
        createLabel={t("new")}
        sub={<p>{t("sub", { count: codes.length, dynamic: dynamicActive })}</p>}
        total={codes.length}
        items={items}
        filters={
          <>
            {usage.plan ? (
              <UsageTiles
                usage={usage}
                printPackCents={priceSheet(currency).printPack}
                currency={currency}
                credits="never"
                className="mb-4 md:grid-cols-3 lg:max-w-200"
              />
            ) : null}
            <SegmentedTrack role="group" aria-label={t("filterLabel")} className="mb-3.5 max-w-[23.75rem]">
              {FILTERS.map((f) => (
                <Link
                  key={f}
                  href={f === "all" ? "/dashboard" : `/dashboard?filter=${f}`}
                  aria-current={f === filter ? "page" : undefined}
                  className={segmentedOption}
                >
                  {t(`filters.${f}`, { count: counts[f] })}
                </Link>
              ))}
            </SegmentedTrack>
          </>
        }
      />
    </>
  );
}
