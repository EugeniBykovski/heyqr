import { ArrowLeftIcon, CheckIcon, DownloadIcon, MinusIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { env } from "@/env";
import { QrPreview } from "@/entities/qr";
import { ActivatePlanButton, StartTrialButton } from "@/features/checkout";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireUser } from "@/server/auth";
import { TRIAL_DAYS, trialCode } from "@/server/billing/trial";
import { userTrial } from "@/server/billing/entitlements";
import { db } from "@/server/db";
import { encodedValue } from "@/server/qr/export";
import { samplePrint } from "@/server/print/sample";
import { dailyScans } from "@/server/qr/repository";
import { pricing } from "@/shared/config/pricing";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trial");
  return { title: t("badge"), robots: { index: false } };
}

/*
 * Design 9.1–9.4 "Trial": the account's real trial, from the server's dates (active, ending, expired, upgraded), its
 * one test Dynamic QR with its real short link and scans, what the trial includes, and what happens when it ends.
 * Activating takes the Dynamic plan through Stripe Checkout for the same code, so the short link stays.
 * While the trial runs, the Print Pack sample: the three print files of a fixed demo QR (never the user's test code).
 */
export default async function TrialPage({ params }: PageProps<"/[locale]/dashboard/trial">) {
  const locale = await resolveLocale(params);
  const sample = samplePrint(env.NEXT_PUBLIC_APP_URL);
  const [t, format, user] = await Promise.all([getTranslations("trial"), getFormatter(), requireUser()]);
  const [phase, code] = await Promise.all([userTrial(user.id), trialCode(db, user.id)]);
  const price = format.number(pricing.dynamicMonthlyCents / 100, { style: "currency", currency: pricing.currency });
  const limit = env.DYNAMIC_ACTIVE_CODE_LIMIT;
  const back = (
    <Button asChild variant="ghost" size="sm" className="self-start">
      <Link href="/dashboard">
        <ArrowLeftIcon aria-hidden />
        {t("back")}
      </Link>
    </Button>
  );

  if (phase.state === "none")
    return (
      <>
        {back}
        <Card className="max-w-xl gap-4">
          <Badge variant="accent" className="self-start">
            {t("badge")}
          </Badge>
          <h1 className="text-h1">{t("start.title")}</h1>
          <p className="text-secondary-foreground">{phase.eligible ? t("start.text") : t("start.used")}</p>
          {phase.eligible ? <StartTrialButton className="self-start" /> : null}
        </Card>
      </>
    );

  const state = phase.state;
  const date = (d: Date) => format.dateTime(d, { month: "long", day: "numeric" });
  const end = date(phase.endsAt);
  const s = (key: string, values?: Record<string, string | number>) => t(`states.${state}.${key}` as "states.active.title", values ?? {});
  const daysLeft = state === "active" || state === "ending" ? phase.daysLeft : 0;
  const day = state === "active" || state === "ending" ? phase.day : TRIAL_DAYS + 1;
  const layout = code?.layouts.sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const scans = code ? (await dailyScans(code.id, 7)).map((d) => d.count) : [];
  const total = scans.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...scans);
  const shortBase = env.NEXT_PUBLIC_SHORT_LINK_BASE.replace(/\/$/, "").replace(/^https?:\/\//, "");
  const host = (url: string | null) => {
    try {
      return url ? new URL(url).host : "";
    } catch {
      return url ?? "";
    }
  };
  const steps =
    state === "expired"
      ? [
          ["choose", { price }],
          ["same", {}],
          ["room", { limit }],
        ]
      : state === "upgraded"
        ? [
            ["kept", {}],
            ["more", { limit }],
            ["receipt", {}],
          ]
        : [
            ["pause", {}],
            ["free", {}],
            ["wake", {}],
          ];
  const activate =
    code && layout ? (
      <ActivatePlanButton qrCodeId={code.id} layoutId={layout.id}>
        {s("main", { price })}
      </ActivatePlanButton>
    ) : (
      <Button asChild variant="primary" size="lg">
        <Link href="/pricing">{s("main", { price })}</Link>
      </Button>
    );

  return (
    <>
      {back}
      <header className="flex max-w-measure flex-col gap-2">
        <Badge variant="accent" className="self-start">
          {t("badge")}
        </Badge>
        <h1 className="text-h1">{s("title")}</h1>
        <p className="text-secondary-foreground">{s("lead", { start: date(phase.startedAt), end })}</p>
      </header>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-labelledby="trial-status"
            className="flex flex-col gap-4 rounded-2xl bg-inverse p-6 text-inverse-foreground shadow-2 sm:p-7"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <b id="trial-status" className="text-h1x tabular-nums">
                {state === "active" || state === "ending" ? s("big", { days: daysLeft }) : s("big")}
              </b>
              <span className="text-inverse-muted">{s("bigSub", { end })}</span>
            </div>
            <div aria-hidden className="flex gap-1.5">
              {Array.from({ length: TRIAL_DAYS }, (_, i) => i + 1).map((d) => (
                <i
                  key={d}
                  className={cn(
                    "h-1.5 flex-1 rounded-full bg-white/15",
                    d < day && "bg-violet-300",
                    d === day && (state === "active" || state === "ending") && "bg-white",
                  )}
                />
              ))}
            </div>
            <p className="text-inverse-muted">{s("status")}</p>
            <div className="flex flex-wrap gap-3">
              {state === "upgraded" ? (
                <>
                  <Button asChild variant="primary" size="lg">
                    <Link href="/dashboard">{s("main")}</Link>
                  </Button>
                  <Button asChild size="lg">
                    <Link href="/dashboard/billing">{s("second")}</Link>
                  </Button>
                </>
              ) : (
                <>
                  {activate}
                  <Button asChild size="lg">
                    <Link href={state === "expired" ? "/pricing" : "/dashboard"}>{s("second")}</Link>
                  </Button>
                </>
              )}
            </div>
            <span className="text-caption text-inverse-muted">{s("foot")}</span>
          </section>

          <Card aria-labelledby="trial-code" className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="trial-code" className="text-h3">
                {t("code.title")}
              </h2>
              {code ? (
                <Badge variant={state === "expired" ? "warning" : "success"}>
                  {state === "expired" ? t("code.paused") : state === "upgraded" ? t("code.plan") : t("code.live")}
                </Badge>
              ) : null}
            </div>
            {code && layout ? (
              <>
                <div className="flex items-center gap-4">
                  <span className="grid size-20 shrink-0 place-items-center rounded-lg border border-border bg-white p-1.5">
                    <QrPreview layout={layout.design.layout} value={encodedValue(code)} label={code.name} className="size-full" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span className="truncate rounded-md bg-subtle px-3 py-1.5 font-mono text-[0.875rem]">
                      {shortBase}/{code.shortCode}
                    </span>
                    <span className="text-caption text-secondary-foreground">
                      {state === "expired" ? t("code.pausedLine") : t("code.opens", { host: host(code.destination) })}
                    </span>
                  </span>
                </div>
                <div className="flex gap-8">
                  <span className="flex flex-col">
                    <b className="text-h2 tabular-nums">{total}</b>
                    <span className="text-caption text-muted-foreground">{t("code.scans")}</span>
                  </span>
                  <span className="flex flex-col">
                    <b className="text-h2 tabular-nums">{state === "expired" ? 0 : (scans.at(-1) ?? 0)}</b>
                    <span className="text-caption text-muted-foreground">{t("code.today")}</span>
                  </span>
                </div>
                <div role="img" aria-label={t("code.chart", { values: scans.join(", ") })} className="flex h-24 items-end gap-1.5">
                  {scans.map((v, i) => (
                    <span
                      key={i}
                      className={cn("flex-1 rounded-t-xs bg-violet-200", i === scans.length - 1 && state !== "expired" && "bg-violet-500")}
                      style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
                    />
                  ))}
                </div>
                <Button asChild size="sm" className="self-start">
                  <Link href={`/dashboard/qr/${code.id}`}>{state === "expired" ? t("code.view") : t("code.change")}</Link>
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="font-semibold">{t("code.none")}</p>
                <p className="text-secondary-foreground">{t("code.noneText")}</p>
                {state === "active" || state === "ending" ? (
                  <Button asChild variant="primary">
                    <Link href="/create?step=type">{t("code.create")}</Link>
                  </Button>
                ) : null}
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card aria-labelledby="trial-included" className="gap-3">
            <h2 id="trial-included" className="text-h3">
              {state === "upgraded" ? t("included.kept") : t("included.title")}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {(t.raw("included.points") as string[]).map((p) => (
                <li key={p} className="flex items-start gap-2.5">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  {p}
                </li>
              ))}
              <li className="flex items-start gap-2.5 text-muted-foreground">
                <MinusIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t("included.not")}
              </li>
            </ul>
          </Card>
          {state === "active" || state === "ending" ? (
            <Card aria-labelledby="trial-sample" className="gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id="trial-sample" className="text-h3">
                  {t("sample.title")}
                </h2>
                <Badge>{t("sample.badge")}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="grid h-24 w-16 shrink-0 place-items-center rounded-md border border-border bg-white p-1">
                  <QrPreview layout={sample.layout} value={sample.value} label={t("sample.demo")} className="size-full" />
                </span>
                <p className="text-caption text-secondary-foreground">{t("sample.text")}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {(
                  [
                    ["pdf", t("sample.pdf"), t("sample.pdfSub", { w: sample.page.sizes.page.width, h: sample.page.sizes.page.height })],
                    [
                      "svg",
                      t("sample.svg"),
                      t("sample.svgSub", { w: sample.page.sizes.finished.width, h: sample.page.sizes.finished.height }),
                    ],
                    ["spec", t("sample.spec"), t("sample.specSub")],
                  ] as const
                ).map(([file, label, sub]) => (
                  <li key={file}>
                    <a
                      href={`/api/print/sample?file=${file}&locale=${locale}`}
                      className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 py-2 hover:border-border-hover"
                    >
                      <DownloadIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <b className="text-[0.875rem] font-semibold">{label}</b>
                        <span className="truncate text-caption text-muted-foreground">{sub}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card aria-labelledby="trial-end" className="gap-3">
            <h2 id="trial-end" className="text-h3">
              {s("endTitle", { end })}
            </h2>
            <ol className="flex flex-col gap-3">
              {steps.map(([key, values], i) => (
                <li key={key as string} className="flex items-start gap-3">
                  <i className="grid size-7 shrink-0 place-items-center rounded-full bg-violet-50 text-[0.8125rem] font-bold text-violet-800 not-italic">
                    {i + 1}
                  </i>
                  <span>
                    <b className="font-semibold">{t(`steps.${key as string}.t` as "steps.pause.t")}</b>{" "}
                    <span className="text-secondary-foreground">
                      {t(`steps.${key as string}.d` as "steps.pause.d", values as Record<string, string | number>)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
