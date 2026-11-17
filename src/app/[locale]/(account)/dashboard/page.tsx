import { QrCodeIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireUser } from "@/server/auth";
import { encodedValue } from "@/server/qr/export";
import { listQrCodes } from "@/server/qr/repository";
import { Button } from "@/shared/ui/button";
import { segmentedOption, SegmentedTrack } from "@/shared/ui/segmented";
import { libraryList, QrCard, type QrCardStatus } from "@/widgets/qr-library";
import { LibraryHeader } from "./library-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

const FILTERS = ["all", "static", "dynamic"] as const;
type Filter = (typeof FILTERS)[number];

export default async function DashboardPage({ params, searchParams }: PageProps<"/[locale]/dashboard">) {
  await resolveLocale(params);
  const [t, tTypes, format, user, query] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("contentTypes"),
    getFormatter(),
    requireUser(),
    searchParams,
  ]);
  const codes = await listQrCodes(user.id);
  const filter: Filter = FILTERS.find((f) => f === query.filter) ?? "all";
  const counts = {
    all: codes.length,
    static: codes.filter((c) => c.model === "static").length,
    dynamic: codes.filter((c) => c.model === "dynamic").length,
  };
  const dynamicActive = codes.filter((c) => c.model === "dynamic" && c.status === "active").length;
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
    );

  return (
    <div>
      {header}
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
      <ul aria-label={t("title")} className={libraryList}>
        {visible.map((qr) => {
          const layout = qr.layouts[0];
          const paid = qr.model === "dynamic" ? qr.status === "active" : qr.purchasedAt !== null;
          const status: QrCardStatus = qr.status === "active" ? (qr.model === "static" ? "purchased" : "active") : qr.status;
          return (
            <QrCard
              key={qr.id}
              name={qr.name}
              href={`/dashboard/qr/${qr.id}`}
              exportHref={layout ? `/create/export?qr=${qr.id}&layout=${layout.id}` : undefined}
              layout={layout?.design.layout}
              value={encodedValue(qr)}
              typeLabel={tTypes(qr.content.type)}
              model={qr.model}
              modelLabel={t(`model.${qr.model}`)}
              status={status}
              statusLabel={t(`status.${status}`)}
              meta={t("updated", { date: format.dateTime(qr.updatedAt, { dateStyle: "medium" }) })}
              paid={paid}
              labels={{
                open: t("open", { name: qr.name }),
                edit: t("actions.edit"),
                download: t("actions.download"),
                buy: t("actions.buy"),
              }}
            />
          );
        })}
      </ul>
    </div>
  );
}
