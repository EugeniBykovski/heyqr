import { QrCodeIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireAccount } from "../require-account";
import { ownerStatus, scansLive } from "@/server/billing/access";
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
  // HEY-185: a Dynamic code is live only while its scans redirect (the short link's own rule): with no plan, or after
  // the trial, it keeps its row and shows as Not active.
  const access = { plan: Boolean(usage.plan), trial: phase };
  const live = (c: (typeof codes)[number]) => scansLive(c, access);
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
    const status: QrCardStatus = ownerStatus(qr, access);
    return {
      id: qr.id,
      name: qr.name,
      href: `/dashboard/qr/${qr.id}`,
      // Edit design opens the first layout, the one shown here (HEY-45).
      editHref: layout ? `/edit/${qr.id}?layout=${layout.id}` : `/edit/${qr.id}`,
      // HEY-185: a Not active code (its plan ended) isn't bought again: its main action leads to Reactivate.
      exportHref: status === "inactive" ? "/dashboard/billing" : layout ? `/create/export?qr=${qr.id}&layout=${layout.id}` : undefined,
      layout: layout?.design.layout,
      value: encodedValue(qr),
      typeLabel: tTypes(qr.content.type),
      model: qr.model,
      modelLabel: t(`model.${qr.model}`),
      status,
      statusLabel: t(`status.${status}`),
      meta: t("updated", { date: format.dateTime(qr.updatedAt, { dateStyle: "medium" }) }),
      paid,
      // HEY-199: only a live, plan-held Dynamic code frees a slot when deleted (not a trial, paused or no-plan code).
      holdsSlot: qr.model === "dynamic" && qr.status === "active" && !qr.isTrial && access.plan,
      printPackLabel: qr.printPackAt ? t("printPack") : undefined,
      shortLink: qr.shortCode ? `${shortBase.replace(/^https?:\/\//, "")}/${qr.shortCode}` : undefined,
      labels: {
        open: t("open", { name: qr.name }),
        edit: t("actions.edit"),
        download: t("actions.download"),
        buy: status === "inactive" ? t("actions.reactivate") : t("actions.buy"),
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
        // HEY-79: a filter with no matches is not an empty account: it says so and leads back to All.
        noMatch={
          filter === "all" ? undefined : (
            <div
              role="status"
              className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-input bg-surface px-5 py-10 text-center"
            >
              <h2 className="text-h2">{t(`noMatch.${filter}`)}</h2>
              <p className="max-w-measure text-secondary-foreground">{t("noMatch.text")}</p>
              <Button asChild>
                <Link href="/dashboard">{t("noMatch.all")}</Link>
              </Button>
            </div>
          )
        }
        filters={
          <>
            {/* HEY-136: the paid quota (slots used and available, this month's allowances) and purchased credits. */}
            {usage.plan || usage.credits > 0 ? (
              <UsageTiles
                usage={usage}
                printPackCents={priceSheet(currency).printPack}
                currency={currency}
                className="mb-4 sm:grid-cols-2 lg:max-w-240 lg:grid-cols-4"
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
