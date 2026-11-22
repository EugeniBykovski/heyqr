import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { BillingPortalButton } from "@/features/checkout";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireAccount } from "../../require-account";
import { accountUsage } from "@/server/billing/allowances";
import { userTrial } from "@/server/billing/entitlements";
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
  const [usage, purchases, phase] = await Promise.all([
    accountUsage(db, user.id),
    db.query.purchase.findMany({
      where: eq(schema.purchase.userId, user.id),
      orderBy: desc(schema.purchase.createdAt),
      with: { qrCode: true },
    }),
    userTrial(user.id),
  ]);
  const plan = usage.plan;
  const sheet = priceSheet(currency);
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const status = !plan ? "statusNone" : plan.cancelAtPeriodEnd ? "statusCanceling" : "statusActive";

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

      <TrialBar phase={phase} />

      <section aria-labelledby="bill-plan" className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted-foreground">{t("current")}</span>
            <h2 id="bill-plan" className="text-h3">
              {plan ? t("planMonthly", { plan: t(`plans.${plan.id}`) }) : t("noPlan")}
            </h2>
          </div>
          <Badge variant={plan ? (plan.cancelAtPeriodEnd ? "warning" : "success") : "neutral"}>{t(status)}</Badge>
        </div>
        <UsageTiles usage={usage} printPackCents={sheet.printPack} currency={currency} />
        {plan ? (
          <dl className="flex flex-col gap-2 text-[0.875rem]">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary-foreground">{t("price")}</dt>
              <dd className="font-semibold tabular-nums">{t("perMonth", { price: formatMoney(sheet[plan.id], currency) })}</dd>
            </div>
            {plan.periodEnd ? (
              <div className="flex justify-between gap-3">
                <dt className="text-secondary-foreground">{plan.cancelAtPeriodEnd ? t("endsOn") : t("renewsOn")}</dt>
                <dd className="font-semibold">{date(plan.periodEnd)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-secondary-foreground">{t("payment")}</dt>
              <dd className="text-right font-semibold">{t("paymentStripe")}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-secondary-foreground">{t("none")}</p>
        )}
        <div className="flex flex-wrap gap-2.5">
          {plan?.id === "starter" && user.stripeCustomerId ? (
            <BillingPortalButton variant="primary" label={t("upgrade", { price: formatMoney(sheet.studio, currency) })} />
          ) : null}
          {!plan ? (
            <Button asChild variant="primary">
              <Link href="/pricing">{t("choosePlan")}</Link>
            </Button>
          ) : null}
          {user.stripeCustomerId ? <BillingPortalButton /> : null}
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
