import { CheckIcon, CircleDotIcon, InfoIcon, RotateCcwIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CurrencySelect, PackPicker, PaymentInfo, PlanCheckoutButton, StartTrialButton } from "@/features/checkout";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { getSession } from "@/server/auth";
import { accountUsage } from "@/server/billing/allowances";
import { forSale, userTrial } from "@/server/billing/entitlements";
import { getCurrency } from "@/server/currency";
import { db } from "@/server/db";
import { supportEmail } from "@/server/support";
import { DRAFT_LIMIT, formatMoney, OFFERS, PACK_CREDITS, PLANS, priceSheet } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { compareData, PlanCompare } from "@/widgets/plan-compare";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans");
  return { title: t("title") };
}

const card = "flex min-w-0 flex-col gap-4.5 rounded-2xl border border-border bg-surface p-6 shadow-1";

/*
 * Design 4.8 / 7.1 Pricing. One-time: Free, Single QR, Static Packs (3 or 10 credits) and the Print Pack add-on;
 * Monthly: Starter (7-day free trial) and Studio; how unlocks and limits work; the comparison table. Prices come from
 * the catalog in the viewer's currency (USD / PLN) and are the amounts checkout charges; an offer without a price
 * in that currency says so instead of showing another currency or a conversion.
 */
export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  await resolveLocale(params);
  const [t, currency, session] = await Promise.all([getTranslations("plans"), getCurrency(), getSession()]);
  const sheet = priceSheet(currency);
  const money = (cents: number | null) => formatMoney(cents, currency);
  const sale = Object.fromEntries(OFFERS.map((o) => [o, forSale(currency, o)])) as Record<(typeof OFFERS)[number], boolean>;
  const missing = OFFERS.filter((o) => sheet[o] === null);
  const [phase, usage] = session ? await Promise.all([userTrial(session.user.id), accountUsage(db, session.user.id)]) : [null, null];
  const pp = money(sheet.printPack);
  const per = (cents: number | null, n: number) => formatMoney(cents === null ? null : Math.round(cents / n), currency);
  const unavailable = t("unavailable", { currency });

  const trialCta = !session ? (
    <Button asChild variant="primary" size="lg" className="w-full">
      <Link href="/sign-in?next=/dashboard/trial">{t("starter.trial")}</Link>
    </Button>
  ) : phase?.state === "none" && phase.eligible ? (
    <StartTrialButton className="w-full" />
  ) : phase && (phase.state === "active" || phase.state === "ending") ? (
    <Button asChild variant="primary" size="lg" className="w-full">
      <Link href="/dashboard/trial">{t("starter.openTrial")}</Link>
    </Button>
  ) : null;
  const onPlan = usage?.plan?.id;
  const planCta = (plan: "starter" | "studio", label: string, variant: "primary" | "ghost") =>
    !session ? (
      <Button asChild variant={variant} size={variant === "ghost" ? "md" : "lg"} className="w-full">
        <Link href={`/sign-in?next=${encodeURIComponent("/pricing")}`}>{label}</Link>
      </Button>
    ) : onPlan ? (
      <Button asChild variant={onPlan === plan ? "secondary" : variant} size={variant === "ghost" ? "md" : "lg"} className="w-full">
        <Link href="/dashboard/billing">{onPlan === plan ? t("current") : t("manage")}</Link>
      </Button>
    ) : (
      <PlanCheckoutButton plan={plan} returnTo="billing" variant={variant} size={variant === "ghost" ? "md" : "lg"} disabled={!sale[plan]}>
        {label}
      </PlanCheckoutButton>
    );

  const compare = compareData(t, sheet, currency);

  return (
    <main className="mx-auto w-full max-w-page px-4 pt-6 pb-8 sm:px-6 md:pt-10 md:pb-16 lg:px-8">
      <header className="mb-6 flex max-w-190 flex-col gap-2">
        <h1 className="text-h1">{t("title")}</h1>
        <p className="text-secondary-foreground">{t("lead")}</p>
      </header>
      <div className="mt-1 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <CurrencySelect value={currency} label={t("currencyLabel")} />
      </div>
      {currency !== "USD" || missing.length ? (
        <p
          role="status"
          className="mb-2 flex max-w-3xl items-start gap-2.5 rounded-md bg-subtle px-3.5 py-3 text-[0.875rem] text-secondary-foreground"
        >
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {missing.length ? (
              <>
                <b className="text-foreground">{t("pendingTitle", { currency })}</b> {t("pendingText", { currency })}
              </>
            ) : (
              <>
                <b className="text-foreground">{t("localTitle", { currency })}</b> {t("localText")}
              </>
            )}
          </span>
        </p>
      ) : null}

      <section aria-labelledby="pr-once" className="mt-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <h2 id="pr-once" className="text-h2">
            {t("once.title")}
          </h2>
          <span className="text-secondary-foreground">{t("once.sub")}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <article className={card}>
            <div className="flex flex-col gap-2">
              <h3 className="text-h2">{t("free.title")}</h3>
              <Price value={money(0)} />
            </div>
            <p className="rounded-md bg-subtle px-3.5 py-3 text-[0.875rem]">{t("free.q")}</p>
            <ul className="flex flex-col gap-2 text-[0.875rem]">
              {(["a", "b", "c"] as const).map((k) => (
                <li key={k} className="flex items-start gap-2.5">
                  <Check />
                  {t(`free.${k}`, { limit: DRAFT_LIMIT })}
                </li>
              ))}
            </ul>
            <Button asChild size="lg" className="mt-auto w-full">
              <Link href="/create">{t("free.cta")}</Link>
            </Button>
          </article>
          <article className={card}>
            <div className="flex flex-col gap-2">
              <h3 className="text-h2">{t("single.title")}</h3>
              <Price value={money(sheet.single)} unit={t("single.unit")} />
            </div>
            <p className="rounded-md bg-subtle px-3.5 py-3 text-[0.875rem]">{t("single.q")}</p>
            <ul className="flex flex-col gap-2 text-[0.875rem]">
              <li className="flex items-start gap-2.5">
                <Check />
                {t("single.a")}
              </li>
              <li className="flex items-start gap-2.5">
                <Check />
                {t("single.b")}
              </li>
              <li className="flex items-start gap-2.5">
                <Check />
                {t("single.c", { price: pp })}
              </li>
            </ul>
            <Button asChild variant="primary" size="lg" className="mt-auto w-full">
              <Link href="/create">{t("single.cta")}</Link>
            </Button>
          </article>
          <article className={card}>
            <div className="flex flex-col gap-2">
              <h3 className="text-h2">{t("packs.title")}</h3>
              <Price value={money(sheet.pack3)} unit={t("packs.unit", { n: PACK_CREDITS.pack3 })} />
            </div>
            <PackPicker
              signedIn={Boolean(session)}
              forSale={{ pack3: sale.pack3, pack10: sale.pack10 }}
              cta={{ pack3: t("packs.buy", { n: 3 }), pack10: t("packs.buy", { n: 10 }) }}
              unavailable={unavailable}
              options={(["pack3", "pack10"] as const).map((id) => ({
                id,
                n: PACK_CREDITS[id],
                price: money(sheet[id]),
                label: t("packs.credits", { n: PACK_CREDITS[id] }),
                each: t("packs.each", { price: per(sheet[id], PACK_CREDITS[id]) }),
              }))}
              note={t("packs.note")}
            />
          </article>
        </div>
        <div
          id="print-pack"
          className="grid gap-4 rounded-xl bg-inverse p-5 text-inverse-foreground lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] lg:items-center lg:px-7 lg:py-6"
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-accent-strong uppercase">{t("pp.kicker")}</span>
            <h3 className="text-h2">{t("pp.title", { price: pp })}</h3>
            <p className="text-inverse-muted">{t("pp.text", { n: PLANS.studio.packs })}</p>
          </div>
          <div className="grid gap-2.5 md:grid-cols-3">
            {(["pdf", "svg", "spec"] as const).map((k) => (
              <div
                key={k}
                className="rounded-md bg-white/6 px-3.5 py-3 text-[0.84rem] text-inverse-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]"
              >
                <b className="mb-0.5 block text-[0.9rem] text-inverse-foreground">{t(`pp.${k}`)}</b>
                {t(`pp.${k}Sub`)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HEY-109: before anyone goes to Stripe: one-time payment, where it happens, the receipt, help, Terms and Privacy. */}
      <PaymentInfo price={money(sheet.single)} support={supportEmail()} className="mt-6 rounded-xl border border-border bg-surface p-5" />

      <section aria-labelledby="pr-month" className="mt-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <h2 id="pr-month" className="text-h2">
            {t("month.title")}
          </h2>
          <span className="text-secondary-foreground">{t("month.sub")}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {(["starter", "studio"] as const).map((plan) => (
            <article
              key={plan}
              className={cn(card, plan === "studio" && "border-border-strong shadow-[0_0_0_1px_var(--border-strong),var(--shadow-2)]")}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-h2">{t(`${plan}.title`)}</h3>
                  <Badge variant={plan === "starter" ? "success" : "accent"}>{t(`${plan}.badge`)}</Badge>
                </div>
                <Price value={money(sheet[plan])} unit={t("perMonth")} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-2 rounded-md bg-accent p-3 shadow-[inset_0_0_0_1px_var(--accent-strong)]">
                  <span className="flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-[0.06em] text-accent-foreground uppercase">
                    <CircleDotIcon aria-hidden className="size-3.5" />
                    {t("live")}
                  </span>
                  <span className="text-[0.84rem]">
                    {t.rich("dynCodes", { n: PLANS[plan].dyn, b: (c) => <b className="tabular-nums">{c}</b> })}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-2 rounded-md bg-subtle p-3">
                  <span className="flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-[0.06em] text-secondary-foreground uppercase">
                    <RotateCcwIcon aria-hidden className="size-3.5" />
                    {t("monthly")}
                  </span>
                  <ul className="flex flex-col gap-1 text-[0.84rem]">
                    <li>{t.rich("unlocks", { n: PLANS[plan].unlocks, b: (c) => <b className="tabular-nums">{c}</b> })}</li>
                    {PLANS[plan].packs ? (
                      <li>{t.rich("packsIncl", { n: PLANS[plan].packs, b: (c) => <b className="tabular-nums">{c}</b> })}</li>
                    ) : null}
                  </ul>
                </div>
              </div>
              <ul className="flex flex-col gap-2 text-[0.875rem]">
                {(["a", "b", "c"] as const).map((k) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <Check />
                    {t(`${plan}.${k}`, { price: pp })}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-2">
                {plan === "starter" ? (
                  <>
                    {onPlan ? null : trialCta}
                    {planCta("starter", t("starter.subscribe", { price: money(sheet.starter) }), onPlan ? "primary" : "ghost")}
                    <span className="text-center text-caption text-muted-foreground">{sale.starter ? t("starter.note") : unavailable}</span>
                  </>
                ) : (
                  <>
                    {planCta("studio", t("studio.cta"), "primary")}
                    {!sale.studio ? <span className="text-center text-caption text-muted-foreground">{unavailable}</span> : null}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="pr-rules" className="mt-8 flex flex-col gap-4">
        <h2 id="pr-rules" className="text-h2">
          {t("rules.title")}
        </h2>
        <div className="grid gap-3 md:grid-cols-2 min-[80rem]:grid-cols-4">
          {([1, 2, 3, 4] as const).map((n) => (
            <div key={n} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4.5">
              <span className="grid size-7.5 place-items-center rounded-full bg-accent text-[0.8125rem] font-bold text-accent-foreground">
                {n}
              </span>
              <b>{t(`rules.${n}t`)}</b>
              <p className="text-[0.875rem] text-secondary-foreground">{t(`rules.${n}d`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="pr-cmp" className="mt-8 flex flex-col gap-4">
        <h2 id="pr-cmp" className="text-h2">
          {t("cmp.title")}
        </h2>
        <PlanCompare
          plans={compare.plans}
          rows={compare.rows}
          initialPair={["single", "starter"]}
          labels={{
            feature: t("cmp.what"),
            region: t("cmp.region"),
            more: t("cmp.more"),
            pick: [t("cmp.pick1"), t("cmp.pick2")],
            yes: t("cmp.yes"),
            no: t("cmp.no"),
            na: t("cmp.na"),
          }}
        />
        <p className="text-caption text-muted-foreground">{t("cmp.foot")}</p>
      </section>
    </main>
  );
}

function Price({ value, unit }: { value: string; unit?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <b className="text-[2.875rem] leading-none tracking-[-0.04em] tabular-nums">{value}</b>
      {unit ? <span className="text-secondary-foreground">{unit}</span> : null}
    </div>
  );
}

function Check() {
  return <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text" />;
}
