import { CheckIcon, MinusIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { env } from "@/env";
import { CurrencyChoice, StartTrialButton } from "@/features/checkout";
import { getSession } from "@/server/auth";
import { userTrial } from "@/server/billing/entitlements";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { pricing } from "@/shared/config/pricing";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  return { title: t("title") };
}

/*
 * Design 4.8 Pricing: One-time and Monthly groups and a comparison table. Only offers the server can actually sell are
 * published, with prices from configuration (the same values checkout charges): Free, Single QR (static) and Dynamic
 * (monthly, with its live-code limit). Credit packs, Starter / Studio and Print Pack from the design are not offered by
 * this deployment, so they are not shown as purchasable.
 */
export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  await resolveLocale(params);
  const t = await getTranslations("pricing");
  const format = await getFormatter();
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: pricing.currency });
  const limit = env.DYNAMIC_ACTIVE_CODE_LIMIT;
  // Design 4.8 / 9.1: the 7-day trial on the Dynamic plan, for accounts that haven't used it (guests sign in first).
  const session = await getSession();
  const phase = session ? await userTrial(session.user.id) : null;
  const trialAction = !session ? (
    <Button asChild size="lg" className="w-full md:w-auto">
      <Link href="/sign-in?next=/dashboard/trial">{t("trial.action")}</Link>
    </Button>
  ) : phase?.state === "none" && phase.eligible ? (
    <StartTrialButton variant="secondary" className="w-full md:w-auto" />
  ) : null;
  const yes = (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CheckIcon aria-hidden className="size-4" />
      <span className="sr-only">{t("compare.yes")}</span>
    </span>
  );
  const no = (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <MinusIcon aria-hidden className="size-4" />
      <span className="sr-only">{t("compare.no")}</span>
    </span>
  );
  const rows: [string, ReactNode, ReactNode, ReactNode][] = [
    [t("compare.rows.design"), yes, yes, yes],
    [t("compare.rows.download"), no, yes, yes],
    [t("compare.rows.repeat"), no, yes, yes],
    [t("compare.rows.change"), no, no, yes],
    [t("compare.rows.analytics"), no, no, yes],
    [t("compare.rows.codes"), t("compare.codesFree"), t("compare.codesSingle"), t("compare.codesDynamic", { limit })],
  ];

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-10 px-4 py-12 sm:px-6 lg:py-16">
      <header className="mx-auto flex max-w-measure flex-col gap-3 text-center">
        <h1 className="text-h1">{t("head")}</h1>
        <p className="text-body-lg text-secondary-foreground">{t("lead")}</p>
      </header>
      <CurrencyChoice charged={pricing.currency} />

      <section aria-labelledby="pr-once" className="flex flex-col gap-4">
        <GroupHead id="pr-once" title={t("once.title")} sub={t("once.sub")} />
        <div className="grid gap-4 md:grid-cols-2">
          <Plan
            name={t("free.name")}
            price={money(0)}
            q={t("free.q")}
            points={t.raw("free.points") as string[]}
            cta={
              <Button asChild size="lg" className="w-full">
                <Link href="/create">{t("free.cta")}</Link>
              </Button>
            }
          />
          <Plan
            featured
            name={t("single.name")}
            price={money(pricing.staticCents)}
            per={t("single.per")}
            q={t("single.q")}
            points={t.raw("single.points") as string[]}
            cta={
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href="/create">{t("single.cta")}</Link>
              </Button>
            }
          />
        </div>
      </section>

      <section aria-labelledby="pr-month" className="flex flex-col gap-4">
        <GroupHead id="pr-month" title={t("monthly.title")} sub={t("monthly.sub")} />
        <Plan
          name={t("dynamic.name")}
          price={money(pricing.dynamicMonthlyCents)}
          per={t("dynamic.per")}
          q={t("dynamic.q")}
          points={t.raw("dynamic.points") as string[]}
          extra={
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3.5 shadow-[inset_3px_0_0_var(--color-violet-500)]">
              <span className="text-micro text-violet-800 uppercase">{t("dynamic.live")}</span>
              <p className="text-h3">{t("dynamic.liveCount", { limit })}</p>
              <p className="text-caption text-secondary-foreground">{t("dynamic.liveHint")}</p>
            </div>
          }
          cta={
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary" size="lg" className="w-full md:w-auto">
                  <Link href="/create?step=type">{t("dynamic.cta")}</Link>
                </Button>
                {trialAction}
              </div>
              {trialAction ? <span className="text-caption text-muted-foreground">{t("trial.note")}</span> : null}
            </div>
          }
        />
      </section>

      <section aria-labelledby="pr-compare" className="flex flex-col gap-4">
        <h2 id="pr-compare" className="text-h2">
          {t("compare.title")}
        </h2>
        {/* The one intentional horizontal scroll on phones (design: comparison table). */}
        <div className="overflow-x-auto rounded-xl border border-border bg-surface" role="region" aria-labelledby="pr-compare" tabIndex={0}>
          <table className="w-full min-w-[34rem] border-collapse text-left text-[0.9375rem]">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="p-3.5 font-semibold text-secondary-foreground">
                  {t("compare.feature")}
                </th>
                <th scope="col" className="p-3.5 font-bold">
                  {t("compare.free")}
                </th>
                <th scope="col" className="p-3.5 font-bold">
                  {t("compare.single")}
                </th>
                <th scope="col" className="p-3.5 font-bold">
                  {t("compare.dynamic")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, a, b, c]) => (
                <tr key={label} className="border-b border-border last:border-0">
                  <th scope="row" className="p-3.5 font-medium">
                    {label}
                  </th>
                  <td className="p-3.5">{a}</td>
                  <td className="p-3.5">{b}</td>
                  <td className="p-3.5">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-muted-foreground">{t("tax")}</p>
      </section>
    </main>
  );
}

function GroupHead({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      <span className="text-secondary-foreground">{sub}</span>
    </div>
  );
}

function Plan({
  name,
  price,
  per,
  q,
  points,
  extra,
  cta,
  featured,
}: {
  name: string;
  price: string;
  per?: string;
  q: string;
  points: string[];
  extra?: ReactNode;
  cta: ReactNode;
  featured?: boolean;
}) {
  return (
    <article
      className={cn(
        "flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6 shadow-1",
        featured && "border-violet-300 shadow-2",
      )}
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-h2">{name}</h3>
        <p className="flex items-baseline gap-2">
          <b className="text-h1x tabular-nums">{price}</b>
          {per ? <span className="text-secondary-foreground">{per}</span> : null}
        </p>
        <p className="text-secondary-foreground">{q}</p>
      </div>
      {extra}
      <ul className="flex flex-col gap-2.5">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-body">
            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-auto">{cta}</div>
    </article>
  );
}
