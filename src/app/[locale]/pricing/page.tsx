import { CheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { env } from "@/env";
import { Link } from "@/i18n/navigation";
import { pricing } from "@/shared/config/pricing";
import { Button } from "@/shared/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  return { title: t("title") };
}

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  await resolveLocale(params);
  const t = await getTranslations("pricing");
  const format = await getFormatter();
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: pricing.currency });
  const limit = env.DYNAMIC_ACTIVE_CODE_LIMIT;

  const plans = [
    { key: "static" as const, price: t("static.price", { price: money(pricing.staticCents) }), points: t.raw("static.points") as string[] },
    {
      key: "dynamic" as const,
      price: t("dynamic.price", { price: money(pricing.dynamicMonthlyCents) }),
      points: (t.raw("dynamic.points") as string[]).map((p) => p.replace("{limit}", String(limit))),
    },
  ];

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-14 sm:px-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-h1">{t("title")}</h1>
        <p className="text-body-lg text-secondary-foreground">{t("lead")}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.key} className={plan.key === "static" ? "border-violet-300" : undefined}>
            <CardHeader>
              <CardTitle>{t(`${plan.key}.name`)}</CardTitle>
              <p className="text-h1">{plan.price}</p>
              <CardDescription>{t(`${plan.key}.text`)}</CardDescription>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {plan.points.map((point) => (
                <li key={point} className="flex items-start gap-2 text-body">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  {point}
                </li>
              ))}
            </ul>
            <Button asChild variant={plan.key === "static" ? "primary" : "secondary"} className="mt-auto">
              <Link href="/create">{t("cta")}</Link>
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
