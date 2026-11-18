import {
  ArrowRightIcon,
  FrameIcon,
  ImageIcon,
  MoveRightIcon,
  PaletteIcon,
  PlusIcon,
  PrinterIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { CENTER_ICONS, FRAME_STYLES } from "@/entities/qr";
import { env } from "@/env";
import { HomeExamples, QuickStart, TypeChips } from "@/features/qr-editor";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { pricing } from "@/shared/config/pricing";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Container } from "@/shared/ui/container";
import { HomeFooter } from "@/widgets/site-footer";
import { Studio, StudioSkeleton } from "@/widgets/studio";
import { getSession } from "@/server/auth";

const STEPS = ["content", "design", "download"] as const;
const FEATURES: { key: "scan" | "style" | "logo" | "frames" | "files" | "dynamic"; icon: LucideIcon }[] = [
  { key: "scan", icon: ShieldCheckIcon },
  { key: "style", icon: PaletteIcon },
  { key: "logo", icon: ImageIcon },
  { key: "frames", icon: FrameIcon },
  { key: "files", icon: PrinterIcon },
  { key: "dynamic", icon: RefreshCwIcon },
];
const FAQ = ["model", "scan", "account", "files", "again"] as const;

/** Design "hsec__head": kicker, section title and lead; `split` puts an aside on the right from 768 px. */
function SectionHead({ id, kicker, title, lead, aside }: { id?: string; kicker: string; title: string; lead: string; aside?: ReactNode }) {
  const copy = (
    <>
      <span className="text-kicker text-accent-text uppercase">{kicker}</span>
      <h2 id={id} className="text-h1x text-balance">
        {title}
      </h2>
      <p className="text-body-lg text-secondary-foreground">{lead}</p>
    </>
  );
  if (!aside) return <div className="mb-6 flex max-w-180 flex-col gap-2.5 md:mb-9">{copy}</div>;
  return (
    <div className="mb-6 flex flex-col gap-2.5 md:mb-9 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="flex max-w-160 flex-col gap-2.5">{copy}</div>
      {aside}
    </div>
  );
}

const section = "reveal py-12 lg:py-18";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  await resolveLocale(params);
  const [t, tNav, format, session] = await Promise.all([getTranslations("home"), getTranslations("nav"), getFormatter(), getSession()]);
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: pricing.currency });
  const prices = { static: money(pricing.staticCents), dynamic: money(pricing.dynamicMonthlyCents), limit: env.DYNAMIC_ACTIVE_CODE_LIMIT };
  const b = (chunks: ReactNode) => <b className="font-semibold">{chunks}</b>;

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

      {session ? (
        <Suspense fallback={<StudioSkeleton label={t("studio.loading")} />}>
          <Studio userId={session.user.id} name={session.user.name} />
        </Suspense>
      ) : null}

      <section aria-label={t("how.label")} className="grid reveal gap-3 pb-8 md:grid-cols-3">
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

      <section aria-labelledby="home-examples" className={section}>
        <SectionHead
          id="home-examples"
          kicker={t("examples.kicker")}
          title={t("examples.title")}
          lead={t("examples.lead")}
          aside={
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <MoveRightIcon aria-hidden className="size-4" />
              {t("examples.hint")}
            </span>
          }
        />
        <HomeExamples />
      </section>

      <section aria-labelledby="home-features" className={section}>
        <SectionHead id="home-features" kicker={t("features.kicker")} title={t("features.title")} lead={t("features.lead")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {FEATURES.map(({ key, icon: Icon }, i) => {
            const ink = i === 0;
            return (
              <article
                key={key}
                className={cn(
                  "flex flex-col gap-2.5 rounded-xl border p-5.5",
                  ink ? "border-inverse bg-inverse text-inverse-foreground" : "border-border bg-surface",
                )}
              >
                <span
                  className={cn(
                    "mb-1.5 grid size-10.5 place-items-center rounded-md ring-1 ring-inset",
                    ink
                      ? "bg-inverse-foreground/8 text-inverse-accent ring-inverse-foreground/14"
                      : "bg-accent text-accent-text ring-accent-strong",
                  )}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={1.9} />
                </span>
                <h3 className="text-h3">{t(`features.${key}.title`)}</h3>
                <p className={ink ? "text-inverse-muted" : "text-secondary-foreground"}>
                  {t(`features.${key}.text`, { icons: Object.keys(CENTER_ICONS).length, frames: FRAME_STYLES.length })}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="home-types" className={section}>
        <SectionHead id="home-types" kicker={t("types.kicker")} title={t("types.title")} lead={t("types.lead")} />
        <TypeChips />
      </section>

      <section aria-labelledby="models-title" className="grid reveal gap-3 pb-12 md:grid-cols-[1.2fr_1fr_1fr] md:items-stretch">
        <div className="flex flex-col gap-2 py-2">
          <h2 id="models-title" className="text-h2">
            {t("models.title")}
          </h2>
          <p className="text-secondary-foreground">{t("models.lead")}</p>
        </div>
        <Card className="gap-3">
          <Badge className="self-start">{t("models.static.badge")}</Badge>
          <p>{t.rich("models.static.text", { price: prices.static, b })}</p>
        </Card>
        <Card className="gap-3">
          <Badge variant="accent" className="self-start">
            {t("models.dynamic.badge")}
          </Badge>
          <p>{t.rich("models.dynamic.text", { price: prices.dynamic, limit: prices.limit, b })}</p>
        </Card>
      </section>

      <section aria-labelledby="home-faq" className={section}>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:items-start lg:gap-16">
          <SectionHead id="home-faq" kicker={t("faq.kicker")} title={t("faq.title")} lead={t("faq.lead")} />
          <div className="flex flex-col border-t border-border [interpolate-size:allow-keywords]">
            {FAQ.map((q) => (
              <details
                key={q}
                className="group border-b border-border [&::details-content]:overflow-hidden [&::details-content]:transition-[block-size,content-visibility] [&::details-content]:transition-discrete [&::details-content]:duration-(--motion-panel) [&::details-content]:ease-out [&::details-content]:[block-size:0] open:[&::details-content]:[block-size:auto]"
              >
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-sm px-1 py-4 text-[1rem] font-semibold transition-colors duration-(--motion-fast) hover:text-accent-text [&::-webkit-details-marker]:hidden">
                  {t(`faq.items.${q}.q`)}
                  <PlusIcon
                    aria-hidden
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-(--motion-base) ease-out group-open:rotate-45"
                  />
                </summary>
                <p className="max-w-measure px-1 pb-5 leading-[1.6] text-secondary-foreground">
                  {t(`faq.items.${q}.a`, { static: prices.static, dynamic: prices.dynamic, limit: prices.limit })}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-label={t("cta.label")} className={section}>
        <div className="relative grid items-center gap-6 overflow-hidden rounded-2xl bg-inverse px-6 py-8 text-inverse-foreground md:grid-cols-[minmax(0,1fr)_auto] md:gap-10 md:p-14">
          <svg aria-hidden viewBox="0 0 32 32" className="pointer-events-none absolute -right-15 -bottom-20 size-80 text-icon-muted">
            <rect x="10" y="10" width="12" height="12" rx="3.6" fill="currentColor" />
          </svg>
          <div className="relative flex max-w-155 flex-col gap-3">
            <h2 className="text-h1x text-balance">{t("cta.title")}</h2>
            <p className="text-body-lg text-inverse-muted">{t("cta.lead", { price: prices.static })}</p>
          </div>
          <div className="relative flex flex-wrap gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/create">
                {tNav("createCode")}
                <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
            {/* Design ".cta .btn:not(.btn--primary)": the secondary button on ink is outlined and transparent. */}
            <Button
              asChild
              size="lg"
              className="border-inverse-border bg-transparent text-inverse-foreground shadow-none hover:border-inverse-border-hover hover:bg-inverse-foreground/6 not-disabled:hover:animate-pulse-inverse"
            >
              <Link href="/pricing">{t("cta.pricing")}</Link>
            </Button>
          </div>
        </div>
      </section>

      <HomeFooter />
    </Container>
  );
}
