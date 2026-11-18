import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { QrEditor } from "@/features/qr-editor";
import { getSession } from "@/server/auth";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("editor");
  return { title: t("title") };
}

/** Design "editor": Type → Content → Design on one route; the step is in ?step=. */
export default async function CreatePage({ params, searchParams }: PageProps<"/[locale]/create">) {
  await resolveLocale(params);
  const [session, query] = await Promise.all([getSession(), searchParams]);

  return (
    // Each editor step renders its own h1 (Type, Content, Design).
    <QrEditor signedIn={Boolean(session)} resume={query.resume === "1"} />
  );
}
