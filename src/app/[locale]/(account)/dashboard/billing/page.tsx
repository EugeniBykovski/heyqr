import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { BillingPortalButton } from "@/features/checkout";
import { requireUser } from "@/server/auth";
import { activeSubscription } from "@/server/billing/entitlements";
import { db, schema } from "@/server/db";
import { Badge } from "@/shared/ui/badge";
import { Card, CardTitle } from "@/shared/ui/card";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing");
  return { title: t("title"), robots: { index: false } };
}

export default async function BillingPage({ params }: PageProps<"/[locale]/dashboard/billing">) {
  await resolveLocale(params);
  const [t, format, user] = await Promise.all([getTranslations("billing"), getFormatter(), requireUser()]);
  const [subscription, purchases] = await Promise.all([
    activeSubscription(user.id),
    db.query.purchase.findMany({
      where: eq(schema.purchase.userId, user.id),
      orderBy: desc(schema.purchase.createdAt),
      with: { qrCode: true },
    }),
  ]);

  return (
    <>
      <h1 className="text-h1">{t("title")}</h1>
      <Card>
        <CardTitle>{t("plan")}</CardTitle>
        {subscription ? (
          <p className="text-body">
            {subscription.currentPeriodEnd
              ? t(subscription.cancelAtPeriodEnd ? "cancels" : "active", {
                  date: format.dateTime(subscription.currentPeriodEnd, { dateStyle: "long" }),
                })
              : subscription.status}
          </p>
        ) : (
          <p className="text-body text-secondary-foreground">{t("none")}</p>
        )}
        {user.stripeCustomerId ? <BillingPortalButton /> : null}
      </Card>
      <Card>
        <CardTitle>{t("purchases")}</CardTitle>
        {purchases.length === 0 ? (
          <p className="text-body text-secondary-foreground">{t("noPurchases")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="text-body font-medium">{p.qrCode.name}</span>
                <span className="flex items-center gap-3 text-body">
                  {format.number(p.amountTotal / 100, { style: "currency", currency: p.currency.toUpperCase() })}
                  <Badge variant={p.status === "paid" ? "success" : "neutral"}>{p.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
