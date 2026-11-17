import { getFormatter, getTranslations } from "next-intl/server";
import { env } from "@/env";
import { QuickStart } from "@/features/qr-editor";
import { resolveLocale } from "@/i18n/server";
import { pricing } from "@/shared/config/pricing";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Container } from "@/shared/ui/container";

const STEPS = ["content", "design", "download"] as const;

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  await resolveLocale(params);
  const [t, format] = await Promise.all([getTranslations("home"), getFormatter()]);
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: pricing.currency });
  const b = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;

  return (
    <Container>
      <QuickStart
        copy={
          <>
            <span className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-surface py-1 pr-3 pl-1.5 text-[0.8125rem] font-semibold text-secondary-foreground">
              <i aria-hidden className="ml-1.5 size-2 rounded-full bg-selected-mark" />
              {t("hero.eyebrow")}
            </span>
            <h1 className="text-display text-balance">{t("hero.title")}</h1>
            <p className="max-w-measure text-body-lg text-secondary-foreground">{t("hero.lead")}</p>
          </>
        }
      />

      <section aria-label={t("how.label")} className="grid gap-3 pb-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step} className="flex items-start gap-3.5 rounded-lg border border-border bg-surface p-4.5">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[0.8125rem] font-bold text-accent-foreground ring-1 ring-accent-strong ring-inset"
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-h3">{t(`how.${step}.title`)}</h2>
              <p className="text-secondary-foreground">{t(`how.${step}.text`)}</p>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="models-title" className="grid gap-3 pb-12 md:grid-cols-[1.2fr_1fr_1fr] md:items-stretch">
        <div className="flex flex-col gap-2 py-2">
          <h2 id="models-title" className="text-h2">
            {t("models.title")}
          </h2>
          <p className="text-secondary-foreground">{t("models.lead")}</p>
        </div>
        <Card className="gap-3">
          <Badge className="self-start">{t("models.static.badge")}</Badge>
          <p>{t.rich("models.static.text", { price: money(pricing.staticCents), b })}</p>
        </Card>
        <Card className="gap-3">
          <Badge variant="accent" className="self-start">
            {t("models.dynamic.badge")}
          </Badge>
          <p>{t.rich("models.dynamic.text", { price: money(pricing.dynamicMonthlyCents), limit: env.DYNAMIC_ACTIVE_CODE_LIMIT, b })}</p>
        </Card>
      </section>
    </Container>
  );
}
