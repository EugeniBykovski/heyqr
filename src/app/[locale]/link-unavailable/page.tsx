import { Link2OffIcon, PauseCircleIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/server";

export const metadata = { robots: { index: false } };

/**
 * Where a short link goes when it can't redirect. `?reason=paused` (design 9.3): a trial's test code after the trial,
 * kept but paused until its owner takes the Dynamic plan. The page never says whose code it is or where it led.
 */
export default async function LinkUnavailablePage({ params, searchParams }: PageProps<"/[locale]/link-unavailable">) {
  await resolveLocale(params);
  const paused = (await searchParams).reason === "paused";
  const t = await getTranslations(paused ? "errors.linkPaused" : "errors.linkUnavailable");
  const Icon = paused ? PauseCircleIcon : Link2OffIcon;
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <Icon aria-hidden className="size-10 text-muted-foreground" />
      <h1 className="text-h1">{t("title")}</h1>
      <p className="text-body text-secondary-foreground">{t("text")}</p>
    </section>
  );
}
