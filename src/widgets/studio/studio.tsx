import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { QrPreview } from "@/entities/qr";
import { env } from "@/env";
import { Link } from "@/i18n/navigation";
import { encodedValue } from "@/server/qr/export";
import { studioSummary } from "@/server/qr/repository";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

const PERKS = ["again", "redirect", "scans", "drafts", "billing"] as const;
const panel = "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4.5 sm:p-5.5";

/**
 * Design 6.1 / 6.2 "Your studio": the signed-in home's dashboard. Totals, scans of all dynamic codes for 14 days,
 * the three most recent codes and what the account includes. With no codes yet it invites the first one (6.2).
 */
export async function Studio({ userId, name }: { userId: string; name: string }) {
  const [t, format, data] = await Promise.all([getTranslations("home.studio"), getFormatter(), studioSummary(userId)]);
  const { codes, scans, scansByCode, filesReady, layoutsByCode } = data;
  const shortBase = env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "").replace(/^https?:\/\//, "");
  const isPaid = (c: (typeof codes)[number]) => (c.model === "dynamic" ? c.status === "active" : c.purchasedAt !== null);
  const paid = codes.filter(isPaid).length;
  const dynamicUsed = codes.filter((c) => c.model === "dynamic" && c.status === "active").length;
  const limit = env.DYNAMIC_ACTIVE_CODE_LIMIT;
  const total = scans.reduce((s, d) => s + d.count, 0);
  const prev = scans.slice(0, 7).reduce((s, d) => s + d.count, 0);
  const last = scans.slice(7).reduce((s, d) => s + d.count, 0);
  const delta = prev > 0 ? (last - prev) / prev : null;
  const max = Math.max(1, ...scans.map((d) => d.count));
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { month: "short", day: "numeric" });
  const top = codes
    .filter((c) => c.model === "dynamic")
    .map((c) => ({ code: c, scans: scansByCode.get(c.id) ?? { total: 0, today: 0 } }))
    .sort((a, b) => b.scans.total - a.scans.total)[0];
  const first = name.trim().split(/\s+/)[0] || name;

  const kpis = [
    { label: t("kpi.codes"), value: codes.length, note: t("kpi.codesNote", { paid, drafts: codes.length - paid }) },
    {
      label: t("kpi.scans"),
      value: total,
      note: delta === null ? t("kpi.scansNone") : t("kpi.scansDelta", { delta }),
      up: delta !== null && delta >= 0,
    },
    {
      label: t("kpi.dynamic"),
      value: `${dynamicUsed} / ${limit}`,
      note: t("kpi.dynamicNote", { left: Math.max(0, limit - dynamicUsed) }),
      meter: Math.min(100, (dynamicUsed / limit) * 100),
    },
    { label: t("kpi.files"), value: filesReady, note: t("kpi.filesNote", { count: filesReady }) },
  ];

  return (
    <section aria-labelledby="studio-title" className="reveal pt-2 pb-6">
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-2 sm:gap-6 sm:p-7 lg:p-9">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-160 flex-col gap-2">
            <span className="text-kicker text-accent-text uppercase">{t("kicker")}</span>
            <h2 id="studio-title" className="text-h1x text-balance">
              {t("welcome", { name: first })}
            </h2>
            <p className="text-body-lg text-secondary-foreground">
              {codes.length === 0
                ? t("summaryEmpty")
                : top && top.scans.today > 0
                  ? t("summaryTop", { name: top.code.name, count: top.scans.today })
                  : t("summary")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild>
              <Link href="/dashboard/billing">{t("billing")}</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href="/dashboard">
                {t("library")}
                <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-page p-4 sm:p-5">
              <dt className="text-[0.8125rem] font-semibold text-secondary-foreground">{k.label}</dt>
              <dd className="text-[clamp(1.625rem,1cqi+1.25rem,2.25rem)] leading-[1.1] font-bold tracking-[-0.03em] tabular-nums">
                {typeof k.value === "number" ? format.number(k.value) : k.value}
              </dd>
              {k.meter !== undefined ? (
                <div
                  role="meter"
                  aria-label={t("kpi.dynamicMeter")}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={dynamicUsed}
                  className="my-0.5 h-1.5 overflow-hidden rounded-full bg-subtle"
                >
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${k.meter}%` }} />
                </div>
              ) : null}
              <dd className={cn("text-[0.8125rem] leading-[1.4]", k.up ? "font-semibold text-success" : "text-muted-foreground")}>
                {k.note}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
          <section aria-labelledby="studio-scans" className={panel}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 id="studio-scans" className="text-h3">
                  {t("chart.title")}
                </h3>
                <span className="text-caption text-muted-foreground">{t("chart.sub")}</span>
              </div>
              <span className="text-[1.375rem] font-bold tracking-[-0.02em] tabular-nums">{format.number(total)}</span>
            </div>
            {total > 0 ? (
              <figure className="flex flex-col gap-2">
                <div
                  role="img"
                  aria-label={`${t("chart.label")}: ${scans.map((d) => `${day(d.day)} ${d.count}`).join(", ")}`}
                  className="flex h-36 items-end gap-1"
                >
                  {scans.map((d, i) => (
                    <div key={d.day} className="flex h-full flex-1 items-end rounded-xs bg-subtle">
                      <span
                        className={cn("block w-full rounded-xs", i === scans.length - 1 ? "bg-primary" : "bg-accent-strong")}
                        style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <figcaption className="flex justify-between text-caption text-muted-foreground">
                  <span>{scans[0] ? day(scans[0].day) : null}</span>
                  <span>{scans[7] ? day(scans[7].day) : null}</span>
                  <span>{t("chart.today")}</span>
                </figcaption>
              </figure>
            ) : (
              <div className="grid h-36 place-items-center rounded-md bg-subtle px-4 text-center text-caption text-muted-foreground">
                {t("chart.empty")}
              </div>
            )}
            <div className="flex flex-col gap-0.5 rounded-md bg-accent px-3.5 py-3 ring-1 ring-accent-strong ring-inset">
              <span className="text-caption text-muted-foreground">{t("top")}</span>
              <span className="text-label">{top ? top.code.name : t("topNone")}</span>
              <span className="text-caption text-secondary-foreground">
                {top ? t("topNote", { count: top.scans.total, link: `${shortBase}/${top.code.shortCode ?? ""}` }) : t("topNoneNote")}
              </span>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <section aria-labelledby="studio-recent" className={panel}>
              <div className="flex items-center justify-between gap-2">
                <h3 id="studio-recent" className="text-h3">
                  {t("recent")}
                </h3>
                {codes.length ? (
                  <Button asChild size="sm" variant="link">
                    <Link href="/dashboard">{t("seeAll", { count: codes.length })}</Link>
                  </Button>
                ) : null}
              </div>
              {codes.length ? (
                <ul>
                  {codes.slice(0, 3).map((c) => {
                    const layout = c.layouts[0];
                    const status = isPaid(c) ? (c.model === "dynamic" ? "dynamic" : "paid") : "draft";
                    return (
                      <li
                        key={c.id}
                        className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
                      >
                        <span className="grid size-13 place-items-center overflow-hidden rounded-md bg-subtle p-1.5">
                          {layout ? (
                            <QrPreview layout={layout.design.layout} value={encodedValue(c)} label={c.name} className="size-full" />
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-label">{c.name}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={status === "dynamic" ? "accent" : status === "paid" ? "success" : "warning"}>
                              {t(`status.${status}`)}
                            </Badge>
                            <span className="text-caption text-muted-foreground">
                              {c.model === "dynamic"
                                ? t("metricScans", { count: scansByCode.get(c.id)?.total ?? 0 })
                                : isPaid(c)
                                  ? t("metricLayouts", { count: layoutsByCode.get(c.id) ?? 0 })
                                  : t("metricFinish")}
                            </span>
                          </span>
                        </span>
                        <Button asChild size="sm" aria-label={t("openName", { name: c.name })}>
                          <Link href={`/dashboard/qr/${c.id}`}>{t("open")}</Link>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-start gap-2.5">
                  <p className="text-secondary-foreground">{t("recentEmpty")}</p>
                  <Button asChild size="sm" variant="primary">
                    <Link href="/create">{t("createFirst")}</Link>
                  </Button>
                </div>
              )}
            </section>
            <section aria-labelledby="studio-perks" className={panel}>
              <h3 id="studio-perks" className="text-h3">
                {t("perksTitle")}
              </h3>
              <ul className="flex flex-col gap-2.5">
                {PERKS.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-[0.875rem] leading-[1.45] text-secondary-foreground">
                    <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />
                    {t(`perks.${p}`)}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
