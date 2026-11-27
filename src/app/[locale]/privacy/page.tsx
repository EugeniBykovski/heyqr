import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/server";
import { privacy } from "@/shared/content/legal/en/privacy";
import { LegalPage } from "@/widgets/legal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  // HEY-193: a draft pending legal review stays out of search until it is approved.
  return { title: t("privacy.title"), robots: { index: false, follow: true } };
}

/** HEY-193: Privacy Policy (draft for owner/legal review; docs/legal/REVIEW.md). */
export default async function Page({ params }: PageProps<"/[locale]/privacy">) {
  const locale = await resolveLocale(params);
  return <LegalPage doc={privacy} locale={locale} />;
}
