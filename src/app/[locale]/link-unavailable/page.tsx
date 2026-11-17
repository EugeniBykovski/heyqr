import { Link2OffIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/server";

export const metadata = { robots: { index: false } };

export default async function LinkUnavailablePage({ params }: PageProps<"/[locale]/link-unavailable">) {
  await resolveLocale(params);
  const t = await getTranslations("errors.linkUnavailable");
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <Link2OffIcon aria-hidden className="size-10 text-muted-foreground" />
      <h1 className="text-h1">{t("title")}</h1>
      <p className="text-body text-secondary-foreground">{t("text")}</p>
    </section>
  );
}
