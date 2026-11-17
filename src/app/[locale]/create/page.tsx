import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { QrEditor } from "@/features/qr-editor";
import { getSession } from "@/server/auth";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("editor");
  return { title: t("title") };
}

export default async function CreatePage({ params, searchParams }: PageProps<"/[locale]/create">) {
  await resolveLocale(params);
  const [t, session, query] = await Promise.all([getTranslations("editor"), getSession(), searchParams]);

  return (
    <section className="mx-auto flex max-w-wide flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-h1">{t("title")}</h1>
      <QrEditor signedIn={Boolean(session)} resume={query.resume === "1"} />
    </section>
  );
}
