import { ArrowRightIcon, BarChart3Icon, CheckIcon, DownloadIcon, LockIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { QrPreview } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { StartTrialButton } from "@/features/checkout";
import { scansLive } from "@/server/billing/access";
import { accountUsage } from "@/server/billing/allowances";
import { userTrial } from "@/server/billing/entitlements";
import { db } from "@/server/db";
import { encodedValue } from "@/server/qr/export";
import { studioSummary } from "@/server/qr/repository";
import { studioMetrics } from "@/server/qr/studio-metrics";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

const POINTS = ["side", "files", "scans", "print"] as const;

/** Initials for the workspace's avatar ("Ana Reyes" → "AR"). */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Design 6.1 / 6.2: under Explore, "Every QR code, in one place." is the signed-in account's own workspace, in the
 * layout visitors see with the sample one: its three most recent codes with their badges, Edit design and Download,
 * the counts by model, the scans of its Dynamic codes for 14 days and who can see it. A new account (6.2) gets one
 * action, and scan analytics that say they come with Starter and Studio. All numbers are the account's own
 * (studioSummary, the plan, the trial); nothing here is sample data.
 */
export async function Studio({ userId, name, email }: { userId: string; name: string; email: string }) {
  const [t, tw, format, data, phase, usage] = await Promise.all([
    getTranslations("home.studio"),
    getTranslations("home.workspace"),
    getFormatter(),
    studioSummary(userId),
    userTrial(userId),
    accountUsage(db, userId),
  ]);
  const { codes, scans, scansByCode, layoutsByCode } = data;
  // HEY-198: the account's figures (rules in studio-metrics.ts), shown as tiles inside the workspace.
  const m = studioMetrics({ ...data, dynamic: usage.dynamic });
  // HEY-185: a Dynamic code counts as live only while its scans redirect (the short link's own rule).
  const access = { plan: Boolean(usage.plan), trial: phase };
  const live = (c: (typeof codes)[number]) => (c.model === "dynamic" ? scansLive(c, access) : c.purchasedAt !== null);
  const staticCount = codes.filter((c) => c.model === "static").length;
  const total = scans.reduce((s, d) => s + d.count, 0);
  const max = Math.max(1, ...scans.map((d) => d.count));
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { month: "short", day: "numeric" });
  const first = name.trim().split(/\s+/)[0] || name;
  // Scan analytics are a Dynamic-plan feature: without a plan, a trial or any scans there is nothing to chart yet.
  const analytics = total > 0 || Boolean(usage.plan) || phase.state === "active" || phase.state === "ending";

  return (
    <section
      aria-labelledby="ws-title"
      className="grid reveal grid-cols-[minmax(0,1fr)] gap-8 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14 lg:py-18"
    >
      <div className="flex flex-col gap-4">
        <span className="text-kicker text-accent-text uppercase">{tw("kicker")}</span>
        <h2 id="ws-title" className="text-h1x text-balance">
          {tw("title")}
        </h2>
        <p className="text-body-lg text-secondary-foreground">
          {codes.length ? t("lead", { name: first }) : t("leadEmpty", { name: first })}
        </p>
        <ul className="flex flex-col gap-2">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-body">
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              {t(`points.${p}`)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3 pt-1">
          <Button asChild variant="primary" size="lg">
            <Link href="/dashboard">
              {t("library")}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/dashboard/billing">{t("billing")}</Link>
          </Button>
          {/* Design 9.x: the trial from the signed-in home, only when the server says this account can start one; a
              running trial links back to its page. */}
          {phase.state === "none" && phase.eligible ? <StartTrialButton size="lg" variant="secondary" /> : null}
          {phase.state === "active" || phase.state === "ending" ? (
            <Button asChild size="lg">
              <Link href="/dashboard/trial">{t("trial", { days: phase.daysLeft })}</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-subtle px-4 py-3 sm:px-5">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-caption font-bold text-accent-text"
            >
              {initials(name)}
            </span>
            <span className="truncate text-label">{name}</span>
            <Badge variant="success">{t("onlyYou")}</Badge>
          </span>
          <p className="flex gap-1 text-[0.8125rem] font-semibold text-secondary-foreground">
            <span className="rounded-full bg-surface px-2.5 py-1 text-foreground shadow-1">{tw("tabs.all", { count: codes.length })}</span>
            <span className="px-2.5 py-1">{tw("tabs.static", { count: staticCount })}</span>
            <span className="px-2.5 py-1">{tw("tabs.dynamic", { count: codes.length - staticCount })}</span>
          </p>
        </div>

        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <dl aria-label={t("kpi.label")} className="grid grid-cols-2 gap-2.5">
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-subtle p-3">
              <dt className="text-caption font-semibold text-secondary-foreground">{t("kpi.codes")}</dt>
              <dd className="text-h3 tabular-nums">{format.number(m.total)}</dd>
              <dd className="text-caption text-muted-foreground">{t("kpi.codesNote", { paid: m.paid, drafts: m.drafts })}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-subtle p-3">
              <dt className="text-caption font-semibold text-secondary-foreground">{t("kpi.scans")}</dt>
              <dd className="text-h3 tabular-nums">{format.number(m.scans)}</dd>
              <dd
                className={cn(
                  "text-caption",
                  m.weekOverWeek !== null && m.weekOverWeek >= 0 ? "font-semibold text-success" : "text-muted-foreground",
                )}
              >
                {m.weekOverWeek !== null
                  ? t("kpi.scansDelta", { delta: m.weekOverWeek })
                  : m.scans > 0
                    ? t("kpi.scansNew")
                    : t("kpi.scansNone")}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-subtle p-3">
              <dt className="text-caption font-semibold text-secondary-foreground">{t("kpi.dynamic")}</dt>
              <dd className="text-h3 tabular-nums">
                {m.dynamic.limit > 0 ? `${m.dynamic.used} / ${m.dynamic.limit}` : format.number(m.dynamic.used)}
              </dd>
              {m.dynamic.limit > 0 ? (
                <dd>
                  <div
                    role="meter"
                    aria-label={t("kpi.dynamicMeter")}
                    aria-valuemin={0}
                    aria-valuemax={m.dynamic.limit}
                    aria-valuenow={m.dynamic.used}
                    className="h-1.5 overflow-hidden rounded-full bg-surface"
                  >
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (m.dynamic.used / m.dynamic.limit) * 100)}%` }}
                    />
                  </div>
                </dd>
              ) : null}
              <dd className="text-caption text-muted-foreground">
                {m.dynamic.limit > 0 ? (
                  t("kpi.dynamicNote", { left: m.dynamic.remaining })
                ) : (
                  <Link href="/dashboard/billing" className="underline underline-offset-2">
                    {t("kpi.dynamicNoPlan")}
                  </Link>
                )}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-subtle p-3">
              <dt className="text-caption font-semibold text-secondary-foreground">{t("kpi.files")}</dt>
              <dd className="text-h3 tabular-nums">{format.number(m.filesReady)}</dd>
              <dd className="text-caption text-muted-foreground">{t("kpi.filesNote", { count: m.filesReady })}</dd>
            </div>
          </dl>
          {codes.length ? (
            <ul aria-label={t("recent")} className="flex flex-col divide-y divide-border">
              {codes.slice(0, 3).map((c) => {
                const layout = c.layouts[0];
                const layouts = layoutsByCode.get(c.id) ?? 0;
                const isLive = live(c);
                const download =
                  c.model === "dynamic" && !isLive
                    ? "/dashboard/billing"
                    : layout
                      ? `/create/export?qr=${c.id}&layout=${layout.id}`
                      : `/dashboard/qr/${c.id}`;
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <Link
                      href={`/dashboard/qr/${c.id}`}
                      aria-label={t("openName", { name: c.name })}
                      className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white p-1"
                    >
                      {layout ? <QrPreview layout={layout.design.layout} value={encodedValue(c)} label="" className="size-full" /> : null}
                    </Link>
                    <span className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
                      <span className="truncate text-label">{c.name}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={c.model === "dynamic" ? "accent" : "neutral"}>{tw(`models.${c.model}`)}</Badge>
                        {c.printPackAt ? <Badge variant="neutral">{t("printPack")}</Badge> : null}
                        {!isLive ? <Badge variant="warning">{c.model === "dynamic" ? t("notActive") : t("status.draft")}</Badge> : null}
                        <span className="text-caption text-muted-foreground">
                          {c.model === "dynamic"
                            ? t("metricScans14", { count: scansByCode.get(c.id)?.total ?? 0 })
                            : t("metricLayouts", { count: layouts })}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Button asChild size="sm" aria-label={t("editName", { name: c.name })}>
                        <Link href={layout ? `/edit/${c.id}?layout=${layout.id}` : `/edit/${c.id}`}>{t("edit")}</Link>
                      </Button>
                      <Button asChild size="sm" aria-label={t("downloadName", { name: c.name })}>
                        <Link href={download}>
                          <DownloadIcon aria-hidden />
                          {t("download")}
                        </Link>
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-secondary-foreground">{t("recentEmpty")}</p>
              <Button asChild size="md" variant="primary">
                <Link href="/create">{t("createFirst")}</Link>
              </Button>
            </div>
          )}

          <section aria-labelledby="ws-scans" className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="flex flex-col gap-0.5">
                <h3 id="ws-scans" className="text-label">
                  {t("chart.title")}
                </h3>
                <span className="text-caption text-muted-foreground">{t("chart.sub")}</span>
              </span>
              <span className="text-h3 tabular-nums">{format.number(total)}</span>
            </div>
            {analytics && total > 0 ? (
              <div
                role="img"
                aria-label={`${t("chart.label")}: ${scans.map((d) => `${day(d.day)} ${d.count}`).join(", ")}`}
                className="flex h-24 items-end gap-1.5 border-b border-border"
              >
                {scans.map((d, i) => (
                  <span
                    key={d.day}
                    className={cn("flex-1 rounded-t-xs", i === scans.length - 1 ? "bg-primary" : "bg-accent-strong")}
                    style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
                  />
                ))}
              </div>
            ) : (
              <p className="grid h-24 place-items-center border-b border-dashed border-border-strong px-4 text-center text-caption text-muted-foreground">
                {analytics ? t("chart.empty") : t("chart.plans")}
              </p>
            )}
            {m.top ? (
              <p className="text-caption text-secondary-foreground">
                <span className="font-semibold text-foreground">{t("top")}: </span>
                <Link href={`/dashboard/qr/${m.top.id}`} className="font-semibold text-accent-text underline underline-offset-2">
                  {m.top.name}
                </Link>{" "}
                · {t("topScans", { count: m.top.scans })}
              </p>
            ) : null}
            <p className="flex items-start gap-2 text-caption text-secondary-foreground">
              <BarChart3Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t("chart.note")}
            </p>
          </section>
        </div>

        <p className="flex items-start gap-2 border-t border-border px-4 py-3 text-caption text-muted-foreground sm:px-5">
          <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t("private", { email })}
        </p>
      </div>
    </section>
  );
}
