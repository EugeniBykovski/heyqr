import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { QrEditor } from "@/features/qr-editor";
import { getSession } from "@/server/auth";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("editor");
  return { title: t("title") };
}

/** Design "editor": full-width workspace (step bar, settings panel, live canvas); the heading is for assistive tech. */
export default async function CreatePage({ params, searchParams }: PageProps<"/[locale]/create">) {
  await resolveLocale(params);
  const [t, session, query] = await Promise.all([getTranslations("editor"), getSession(), searchParams]);

  return (
    <>
      <h1 className="sr-only">{t("title")}</h1>
      <QrEditor signedIn={Boolean(session)} resume={query.resume === "1"} />
    </>
  );
}
