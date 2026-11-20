import { FileTextIcon, PenToolIcon, RulerIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { DEFAULT_DESIGN, designToLayout, QrPreview, SAMPLE_LOGO, type EditorDesign } from "@/entities/qr";
import { Link } from "@/i18n/navigation";
import { formatMoney, type Currency } from "@/shared/config/catalog-core";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

const CARD: EditorDesign = {
  ...DEFAULT_DESIGN,
  preset: "horizontal",
  caption: "Ana Reyes\nView portfolio",
  size: { unit: "mm", qr: 35, width: 90, height: 50 },
};
const LABEL: EditorDesign = {
  ...DEFAULT_DESIGN,
  preset: "caption",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  caption: "Scan for the menu",
  logo: { kind: "image", href: SAMPLE_LOGO },
  logoSize: 0.24,
  logoPlate: "circle",
  size: { unit: "mm", qr: 40, width: 50, height: 62 },
};

/*
 * Design 1.1 "From your screen to the print shop": the Print Pack on Home. Two real print layouts (rendered by the
 * same renderer as the files), what the Print Pack contains and its price in the viewer's currency, and the way to see
 * the actual print page of a demo QR (public Print Preview sample) or the Print Pack's details on Pricing.
 */
export async function PrintPackShowcase({
  cents,
  singleCents,
  currency,
}: {
  cents: number | null;
  singleCents: number | null;
  currency: Currency;
}) {
  const t = await getTranslations("home.printPack");
  const price = formatMoney(cents, currency);
  const files = [
    { icon: FileTextIcon, key: "pdf", tag: "PDF" },
    { icon: PenToolIcon, key: "svg", tag: "SVG" },
    { icon: RulerIcon, key: "spec", tag: "PDF sheet" },
  ] as const;
  return (
    <section aria-labelledby="home-print" className="flex reveal flex-col gap-6 py-12 lg:py-18">
      <div className="flex max-w-measure flex-col gap-2.5">
        <span className="text-kicker text-accent-text uppercase">{t("kicker")}</span>
        <h2 id="home-print" className="text-h1x text-balance">
          {t("title")}
        </h2>
        <p className="text-body-lg text-secondary-foreground">{t("lead")}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-stretch">
        <div className="relative grid min-h-80 place-items-center overflow-hidden rounded-2xl bg-stage p-8">
          <Badge className="absolute top-4 left-4">{t("cardTag")}</Badge>
          <div className="w-[min(78%,26rem)] -rotate-6 drop-shadow-[0_18px_30px_rgb(13_13_18/0.22)]">
            <QrPreview layout={designToLayout(CARD)} value="https://anareyes.studio/portfolio" label={t("cardLabel")} />
          </div>
          <div className="absolute right-[8%] bottom-[8%] w-[min(30%,10rem)] rotate-3 drop-shadow-[0_14px_24px_rgb(13_13_18/0.25)]">
            <QrPreview layout={designToLayout(LABEL)} value="https://littlefern.coffee/menu" label={t("labelLabel")} />
          </div>
          <Badge className="absolute right-4 bottom-4">{t("labelTag")}</Badge>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-1 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-caption text-muted-foreground">{t("panelKicker")}</span>
              <b className="text-h3">{t("panelTitle")}</b>
            </span>
            <span className="text-right">
              <b className="text-h2 tabular-nums">+{price}</b> <span className="text-caption text-muted-foreground">{t("perQr")}</span>
            </span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {files.map(({ icon: Icon, key, tag }) => (
              <li key={key} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="flex min-w-0 grow flex-col">
                  <b className="text-[0.875rem] font-semibold">{t(`files.${key}`)}</b>
                  <span className="text-caption text-secondary-foreground">{t(`files.${key}Sub`)}</span>
                </span>
                <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[0.6875rem] font-semibold text-secondary-foreground">
                  {tag}
                </span>
              </li>
            ))}
          </ul>
          <p className="rounded-md bg-subtle px-3 py-2.5 text-caption text-secondary-foreground">{t("addNote", { price })}</p>
          <dl className="flex flex-col gap-1.5 border-t border-border pt-3 text-[0.875rem]">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary-foreground">{t("single")}</dt>
              <dd className="tabular-nums">{formatMoney(singleCents, currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secondary-foreground">{t("withPack")}</dt>
              <dd className="font-semibold tabular-nums">
                {singleCents !== null && cents !== null ? formatMoney(singleCents + cents, currency) : "—"}
              </dd>
            </div>
          </dl>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button asChild variant="primary">
              <Link href="/pricing#print-pack">{t("details")}</Link>
            </Button>
            <Button asChild>
              <Link href="/print/sample">{t("preview")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
