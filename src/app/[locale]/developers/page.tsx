import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { resolveLocale } from "@/i18n/server";
import { Container } from "@/shared/ui/container";
import { DevelopersPage } from "@/widgets/developers";

export async function generateMetadata({ params }: PageProps<"/[locale]/developers">): Promise<Metadata> {
  await resolveLocale(params);
  const t = await getTranslations("developers");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/** Design 12.x: developer docs for @heyqr/qr-core, the REST API and @heyqr/sdk. */
export default async function Developers({ params }: PageProps<"/[locale]/developers">) {
  await resolveLocale(params);
  return (
    <Container>
      <DevelopersPage apiBase={env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")} />
    </Container>
  );
}
