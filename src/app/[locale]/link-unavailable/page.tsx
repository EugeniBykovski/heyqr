import { Clock3Icon, Link2OffIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/server";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Where a short link goes when it can't redirect (public, never indexed). It never says whose code it is, where it led
 * or anything about the owner's plan.
 * - Default: an unknown, deleted, inactive or destination-less code.
 * - `?reason=inactive` (design 9.3, HEY-121): a trial's test code after the trial, kept until its owner takes the plan.
 *   Neutral copy: it doesn't claim the owner paused it. `paused` is the earlier name of the same reason.
 */
export default async function LinkUnavailablePage({ params, searchParams }: PageProps<"/[locale]/link-unavailable">) {
  await resolveLocale(params);
  const { reason } = await searchParams;
  const inactive = reason === "inactive" || reason === "paused";
  const t = await getTranslations(inactive ? "errors.linkInactive" : "errors.linkUnavailable");
  const Icon = inactive ? Clock3Icon : Link2OffIcon;
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <Icon aria-hidden className="size-10 text-muted-foreground" />
      <h1 className="text-h1">{t("title")}</h1>
      <p className="text-body text-secondary-foreground">{t("text")}</p>
    </section>
  );
}
