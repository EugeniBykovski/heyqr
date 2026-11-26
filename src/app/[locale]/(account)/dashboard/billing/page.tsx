import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { BillingPortalButton, PlanCheckoutButton, ResumeSubscriptionButton } from "@/features/checkout";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireAccount } from "../../require-account";
import { accountUsage, endedPlan, overdueSubscription } from "@/server/billing/allowances";
import { activeSubscription, userTrial } from "@/server/billing/entitlements";
import { paymentSummary, portalFeatures } from "@/server/billing/portal";
import { storedCustomer } from "@/server/billing/customer";
import { trialCode } from "@/server/billing/trial";
import { getCurrency } from "@/server/currency";
import { db, schema } from "@/server/db";
import { formatMoney, isCurrency, priceSheet } from "@/shared/config/catalog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { TrialBar } from "@/widgets/trial";
import { UsageTiles } from "@/widgets/usage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing");
  return { title: t("title"), robots: { index: false } };
}

const card = "flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-6";

/*
 * Design 4.9 / 9.7 "Plan & billing": the current plan with its live usage (active Dynamic slots, this month's static
 * unlocks and included Print Packs, static credits), price, renewal and payment method; Upgrade / Manage subscription in
 * Stripe's portal, Compare plans; one-time purchases line by line, each with Stripe's receipt. Receipts keep the
 * currency that was paid; everything is the account's own data and Stripe stays the source of truth.
 */
export default async function BillingPage({ params, searchParams }: PageProps<"/[locale]/dashboard/billing">) {
  const locale = await resolveLocale(params);
  const user = await requireAccount(locale, "/dashboard/billing", await searchParams);
  const [t, format, currency] = await Promise.all([getTranslations("billing"), getFormatter(), getCurrency()]);
  const [usage, purchases, phase, test, customer, subscription, features, overdue, ended] = await Promise.all([
    accountUsage(db, user.id),
    db.query.purchase.findMany({
      where: eq(schema.purchase.userId, user.id),
      orderBy: desc(schema.purchase.createdAt),
      with: { qrCode: true },
    }),
    userTrial(user.id),
    trialCode(db, user.id),
    // HEY-139: the stored Customer from the database (not the session's copy), and what the Portal allows.
    storedCustomer(db, user.id),
    activeSubscription(user.id),
    portalFeatures(),
    // HEY-141: a renewal that failed and can still be paid (past_due: the plan stays; unpaid: it has ended).
    overdueSubscription(db, user.id),
    // HEY-185: the plan that ended, for Reactivate.
    endedPlan(db, user.id),
  ]);
  const payment = customer && subscription ? await paymentSummary(customer, subscription.stripeSubscriptionId) : null;
  const brand = (b: string) =>
    ({
      visa: "Visa",
      mastercard: "Mastercard",
      amex: "American Express",
      discover: "Discover",
      jcb: "JCB",
      unionpay: "UnionPay",
      diners: "Diners Club",
    })[b] ?? b.charAt(0).toUpperCase() + b.slice(1);
  // HEY-136: the trial's one slot, apart from the paid quota (the same rule as My QR codes: live while the trial runs).
  const trialLive = phase.state === "active" || phase.state === "ending";
  const trialSlotUsed = Boolean(test && test.status === "active" && trialLive);
  const plan = usage.plan;
  const sheet = priceSheet(currency);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const status = !plan ? "statusNone" : plan.overdue ? "overdue.status" : plan.cancelAtPeriodEnd ? "statusCanceling" : "statusActive";

  // Receipt lines: a Single QR with its Print Pack is two lines of one payment, as charged, in the currency paid.
  const rows = purchases.flatMap((p) => {
    const cur = p.currency.toUpperCase();
    const money = (cents: number) =>
      isCurrency(cur) ? formatMoney(cents, cur) : format.number(cents / 100, { style: "currency", currency: cur });
    const name = p.qrCode?.name ?? "";
    const fallback = p.item === "print_pack" ? "printPack" : p.item === "pack10" ? "pack10" : p.item === "pack3" ? "pack3" : "single";
    const lines = p.lines?.length ? p.lines : [{ offer: fallback, amount: p.amountTotal }];
    return lines.map((l, i) => ({
      id: `${p.id}-${i}`,
      purchaseId: p.id,
      label:
        l.offer === "pack3" || l.offer === "pack10"
          ? t("credits", { n: l.offer === "pack10" ? 10 : 3 })
          : `${t(l.offer === "printPack" ? "items.printPack" : "items.single")} · ${name}`,
      date: date(p.paidAt ?? p.createdAt),
      amount: money(l.amount),
      status: p.status,
    }));
  });

  return (
    <div className="mx-auto flex w-full max-w-190 flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-h1">{t("title")}</h1>
        <p className="text-secondary-foreground">{t("signedIn", { email: user.email })}</p>
      </header>

      <TrialBar phase={phase} showUsage={trialLive} slotUsed={trialSlotUsed} />

      <section aria-labelledby="bill-plan" className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted-foreground">{t("current")}</span>
            <h2 id="bill-plan" className="text-h3">
              {plan ? t("planMonthly", { plan: t(`plans.${plan.id}`) }) : t("noPlan")}
            </h2>
          </div>
          <Badge variant={plan ? (plan.overdue || plan.cancelAtPeriodEnd ? "warning" : "success") : "neutral"}>{t(status)}</Badge>
        </div>
        {/* HEY-141: a failed renewal that can still be paid, with the way to pay it (the Portal, no new Checkout). */}
        {overdue && customer ? (
          <div
            role="alert"
            data-slot="renewal-overdue"
            className="flex flex-col gap-2.5 rounded-lg bg-warning-soft px-4 py-3.5 text-[0.9375rem]"
          >
            <b className="font-semibold">{t("overdue.title")}</b>
            {/* HEY-138 policy: past_due keeps the plan; an unpaid (unrecovered) renewal ends it. */}
            <p className="text-secondary-foreground">{overdue.status === "unpaid" ? t("overdue.unpaid") : t("overdue.pastDue")}</p>
            <BillingPortalButton intent="recover" variant="primary" label={t("overdue.action")} />
            <span className="text-caption text-muted-foreground">{t("overdue.pending")}</span>
          </div>
        ) : null}
        {/* HEY-136: the credit balance is always shown here, 0 included. */}
        {/* HEY-185: a scheduled cancellation, its cutoff and what happens then (docs/LINK_AVAILABILITY.md 2a–2b), with
            Keep my plan: the same subscription resumes, no new Checkout or charge. */}
        {plan?.cancelAtPeriodEnd && !plan.overdue && plan.endsAt ? (
          <div data-slot="cancellation-scheduled" className="flex flex-col gap-2.5 rounded-lg bg-warning-soft px-4 py-3.5 text-[0.9375rem]">
            <b className="font-semibold">{t("canceling.title", { date: date(plan.endsAt) })}</b>
            <p className="text-secondary-foreground">{t("canceling.until")}</p>
            <p className="text-secondary-foreground">{t("canceling.after", { count: usage.dynamic.used })}</p>
            <div className="flex flex-wrap gap-2.5">
              <ResumeSubscriptionButton label={t("canceling.resume")} />
            </div>
            <span className="text-caption text-muted-foreground">{t("canceling.resumeNote")}</span>
          </div>
        ) : null}
        {/* HEY-185: the plan has ended. Taking it again turns the same short links back on (2b, 3c); a pause, deletion
            or takedown is the owner's or an operator's and stays. */}
        {!plan && ended && !overdue ? (
          <div data-slot="plan-ended" className="flex flex-col gap-2.5 rounded-lg bg-subtle px-4 py-3.5 text-[0.9375rem]">
            <b className="font-semibold">
              {ended.endedAt
                ? t("ended.title", { plan: t(`plans.${ended.id}`), date: date(ended.endedAt) })
                : t("ended.titleNoDate", { plan: t(`plans.${ended.id}`) })}
            </b>
            <p className="text-secondary-foreground">{t("ended.scans")}</p>
            <p className="text-secondary-foreground">{t("ended.back")}</p>
            <div className="flex flex-wrap gap-2.5">
              <PlanCheckoutButton plan={ended.id} returnTo="billing" size="md" className="w-auto">
                {t("ended.reactivate", { plan: t(`plans.${ended.id}`), price: formatMoney(sheet[ended.id], currency) })}
              </PlanCheckoutButton>
            </div>
          </div>
        ) : null}
        <UsageTiles usage={usage} printPackCents={sheet.printPack} currency={currency} credits="always" />
        {plan ? (
          <dl className="flex flex-col gap-2 text-[0.875rem]">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary-foreground">{t("price")}</dt>
              <dd className="font-semibold tabular-nums">{t("perMonth", { price: formatMoney(sheet[plan.id], currency) })}</dd>
            </div>
            {/* HEY-139: the renewal date, or when a scheduled cancellation takes effect (Stripe's cancel_at). */}
            {/* HEY-141: no renewal date while the renewal itself is unpaid. */}
            {!plan.overdue && (plan.cancelAtPeriodEnd ? plan.endsAt : plan.periodEnd) ? (
              <div className="flex justify-between gap-3">
                <dt className="text-secondary-foreground">{plan.cancelAtPeriodEnd ? t("endsOn") : t("renewsOn")}</dt>
                <dd data-slot="plan-date" className="font-semibold">
                  {date((plan.cancelAtPeriodEnd ? plan.endsAt : plan.periodEnd) ?? new Date())}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-secondary-foreground">{t("payment")}</dt>
              <dd data-slot="payment-method" className="text-right font-semibold">
                {payment?.kind === "card"
                  ? t("card", { brand: brand(payment.brand), last4: payment.last4 })
                  : payment
                    ? brand(payment.type.replace(/_/g, " "))
                    : t("paymentStripe")}
              </dd>
            </div>
          </dl>
        ) : ended ? null : (
          <p className="text-secondary-foreground">{t("none")}</p>
        )}
        <div className="flex flex-wrap gap-2.5">
          {/* HEY-139: only actions the account's state and the Portal configuration allow. */}
          {plan?.id === "starter" && customer && features.upgrade && !plan.cancelAtPeriodEnd && !plan.overdue ? (
            <BillingPortalButton intent="upgrade" variant="primary" label={t("upgrade", { price: formatMoney(sheet.studio, currency) })} />
          ) : null}
          {!plan && !ended ? (
            <Button asChild variant="primary">
              <Link href="/pricing">{t("choosePlan")}</Link>
            </Button>
          ) : null}
          {customer && plan ? <BillingPortalButton /> : null}
          {customer && plan && features.paymentMethodUpdate && !overdue ? (
            <BillingPortalButton intent="payment" label={t("updatePayment")} />
          ) : null}
          <Button asChild>
            <Link href="/pricing">{t("compare")}</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="bill-purchases" className={card}>
        <h2 id="bill-purchases" className="text-h3">
          {t("oneTime")}
        </h2>
        {rows.length === 0 ? (
          <p className="text-secondary-foreground">{t("noPurchases")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-120 border-collapse text-[0.875rem]">
              <thead>
                <tr className="text-left text-secondary-foreground">
                  <th scope="col" className="border-b border-border px-2 py-2 font-semibold">
                    {t("item")}
                  </th>
                  <th scope="col" className="border-b border-border px-2 py-2 font-semibold">
                    {t("date")}
                  </th>
                  <th scope="col" className="border-b border-border px-2 py-2 font-semibold">
                    {t("amount")}
                  </th>
                  <th scope="col" className="border-b border-border px-2 py-2">
                    <span className="sr-only">{t("receipt")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="border-b border-border px-2 py-3.5">{r.label}</td>
                    <td className="border-b border-border px-2 py-3.5">{r.date}</td>
                    <td className="border-b border-border px-2 py-3.5 tabular-nums">{r.amount}</td>
                    <td className="border-b border-border px-2 py-3.5 text-right">
                      {r.status === "paid" ? (
                        <a href={`/api/billing/receipt/${r.purchaseId}`} className="font-semibold underline underline-offset-3">
                          {t("receipt")}
                        </a>
                      ) : (
                        <Badge variant={r.status === "failed" ? "danger" : "neutral"}>{t(`statuses.${r.status}`)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <span className="text-caption text-muted-foreground">{t("receiptNote")}</span>
      </section>
    </div>
  );
}
