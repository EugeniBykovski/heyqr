import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { env } from "@/env";
import { BillingPortalButton } from "@/features/checkout";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { requireUser } from "@/server/auth";
import { activeSubscription, userTrial } from "@/server/billing/entitlements";
import { TrialBar } from "@/widgets/trial";
import { db, schema } from "@/server/db";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardTitle } from "@/shared/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing");
  return { title: t("title"), robots: { index: false } };
}

/*
 * Design 4.9 "Plan & billing": current plan and status, live Dynamic usage against the plan's limit (a live count, not a
 * monthly allowance), renewal, the payment method and subscription in Stripe's portal, Compare plans, and one-time
 * purchases with their real amounts. Everything shown is the account's own data; Stripe stays the source of truth.
 */
export default async function BillingPage({ params }: PageProps<"/[locale]/dashboard/billing">) {
  await resolveLocale(params);
  const [t, format, user] = await Promise.all([getTranslations("billing"), getFormatter(), requireUser()]);
  const [subscription, purchases, [live], phase] = await Promise.all([
    activeSubscription(user.id),
    db.query.purchase.findMany({
      where: eq(schema.purchase.userId, user.id),
      orderBy: desc(schema.purchase.createdAt),
      with: { qrCode: true },
    }),
    db
      .select({ n: count() })
      .from(schema.qrCode)
      .where(
        and(
          eq(schema.qrCode.userId, user.id),
          eq(schema.qrCode.model, "dynamic"),
          eq(schema.qrCode.status, "active"),
          isNull(schema.qrCode.deletedAt),
        ),
      ),
    userTrial(user.id),
  ]);
  const limit = subscription?.activeCodeLimit ?? env.DYNAMIC_ACTIVE_CODE_LIMIT;
  const used = live?.n ?? 0;
  const status = !subscription ? "statusNone" : subscription.cancelAtPeriodEnd ? "statusCanceling" : "statusActive";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-h1">{t("title")}</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/pricing">{t("compare")}</Link>
        </Button>
      </div>

      <TrialBar phase={phase} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("plan")}</CardTitle>
          <Badge variant={subscription ? (subscription.cancelAtPeriodEnd ? "warning" : "success") : "neutral"}>{t(status)}</Badge>
        </div>
        {subscription ? (
          <p className="text-body">
            {subscription.currentPeriodEnd
              ? t(subscription.cancelAtPeriodEnd ? "cancels" : "renews", {
                  date: format.dateTime(subscription.currentPeriodEnd, { dateStyle: "long" }),
                })
              : subscription.status}
          </p>
        ) : (
          <p className="text-body text-secondary-foreground">{t("none")}</p>
        )}
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3.5 shadow-[inset_3px_0_0_var(--color-violet-500)]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-label">{t("liveDynamic")}</span>
            <b className="tabular-nums">{subscription ? t("liveCount", { used, limit }) : t("liveNoPlan", { used })}</b>
          </div>
          {subscription ? (
            <div
              role="meter"
              aria-label={t("liveDynamic")}
              aria-valuemin={0}
              aria-valuemax={subscription ? limit : 0}
              aria-valuenow={used}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100"
            >
              <span
                className="block h-full rounded-full bg-violet-500"
                style={{ width: `${subscription && limit ? Math.min(100, (used / limit) * 100) : 0}%` }}
              />
            </div>
          ) : null}
          <p className="mt-1.5 text-caption text-secondary-foreground">{t("liveHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label">{t("payment")}</span>
          <p className="text-caption text-secondary-foreground">{t("paymentManaged")}</p>
        </div>
        {user.stripeCustomerId ? <BillingPortalButton /> : null}
      </Card>

      <Card>
        <CardTitle>{t("purchases")}</CardTitle>
        {purchases.length === 0 ? (
          <p className="text-body text-secondary-foreground">{t("noPurchases")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium">{p.qrCode.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {format.dateTime(p.paidAt ?? p.createdAt, { dateStyle: "medium" })}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-body tabular-nums">
                  {format.number(p.amountTotal / 100, { style: "currency", currency: p.currency.toUpperCase() })}
                  <Badge variant={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "neutral"}>
                    {t(`statuses.${p.status}`)}
                  </Badge>
                  {p.status === "paid" && !p.qrCode.deletedAt ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/dashboard/qr/${p.qrCodeId}`}>{t("open")}</Link>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-caption text-muted-foreground">{t("receiptNote")}</p>
      </Card>
    </>
  );
}
