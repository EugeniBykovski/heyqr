import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GoogleSignInButton } from "@/features/auth";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/server/auth";
import { Card } from "@/shared/ui/card";
import { LogoMark } from "@/shared/ui/logo";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("title"), robots: { index: false } };
}

/** Only same-site relative paths are accepted as the return target. */
const safeNext = (next: string | string[] | undefined) =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const locale = await resolveLocale(params);
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect({ href: next, locale });
  const t = await getTranslations("auth");
  const callbackURL = locale === "en" ? next : `/${locale}${next}`;

  return (
    <section className="mx-auto flex max-w-md flex-col px-4 py-16">
      <Card className="items-center gap-6 p-8 text-center">
        <LogoMark className="size-12" />
        <div className="flex flex-col gap-2">
          <h1 className="text-h1">{t("title")}</h1>
          <p className="text-body text-secondary-foreground">{t("lead")}</p>
        </div>
        <GoogleSignInButton callbackURL={callbackURL} />
        <p className="text-caption text-muted-foreground">{t("legal")}</p>
      </Card>
    </section>
  );
}
