import {
  ArrowRightIcon,
  FileImageIcon,
  FrameIcon,
  LayersIcon,
  PaletteIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { DEFAULT_DESIGN, designToLayout, QrPreview } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { resolveLocale } from "@/i18n/server";

const FEATURES: { key: "scan" | "design" | "frames" | "files" | "dynamic" | "types"; icon: LucideIcon }[] = [
  { key: "scan", icon: ShieldCheckIcon },
  { key: "design", icon: PaletteIcon },
  { key: "frames", icon: FrameIcon },
  { key: "files", icon: FileImageIcon },
  { key: "dynamic", icon: RefreshCwIcon },
  { key: "types", icon: LayersIcon },
];

const heroLayout = designToLayout({
  ...DEFAULT_DESIGN,
  fg: "#24137A",
  pattern: "dot",
  eyeFrame: "rounded",
  eyeBall: "circle",
  logo: { kind: "icon", icon: "globe" },
  preset: "frame",
  frameStyle: "bar",
  caption: "View portfolio",
});

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  await resolveLocale(params);
  const t = await getTranslations("home");

  return (
    <>
      <section className="mx-auto grid max-w-page items-center gap-10 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
        <div className="flex animate-rise flex-col items-start gap-6">
          <span className="rounded-full bg-accent px-3 py-1 text-micro text-accent-foreground uppercase">{t("eyebrow")}</span>
          <h1 className="text-display text-balance">{t("title")}</h1>
          <p className="max-w-xl text-body-lg text-secondary-foreground">{t("lead")}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/create">
                {t("cta")}
                <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/pricing">{t("secondary")}</Link>
            </Button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-md rounded-2xl bg-surface p-8 shadow-3 sm:p-10">
          <QrPreview layout={heroLayout} value="https://anareyes.studio/portfolio" label={t("previewLabel")} />
        </div>
      </section>

      <section aria-labelledby="features" className="mx-auto max-w-page px-4 pb-20 sm:px-6">
        <h2 id="features" className="mb-6 text-h1">
          {t("features.title")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <Card className="h-full">
                <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon aria-hidden className="size-5" />
                </span>
                <h3 className="text-h3">{t(`features.${key}.title`)}</h3>
                <p className="text-body text-secondary-foreground">{t(`features.${key}.text`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
