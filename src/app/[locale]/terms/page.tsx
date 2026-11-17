import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("terms.title") };
}

export default async function Page({ params }: PageProps<"/[locale]/terms">) {
  await resolveLocale(params);
  const t = await getTranslations("legal");
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-14 sm:px-6">
      <h1 className="text-h1">{t("terms.title")}</h1>
      <p className="text-body text-secondary-foreground">{t("draft")}</p>
    </article>
  );
}
