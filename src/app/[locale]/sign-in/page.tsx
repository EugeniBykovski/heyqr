import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GoogleSignInButton, safeReturnPath } from "@/features/auth";
import { CircleAlertIcon, InfoIcon } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getSession } from "@/server/auth";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";
import { LogoMark } from "@/shared/ui/logo";
import { resolveLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("title"), robots: { index: false } };
}

/** Better Auth appends `error=<code>` to errorCallbackURL; only a plain code is read (never shown verbatim). */
const authError = (error: string | string[] | undefined) =>
  typeof error === "string" && /^[a-z_]{1,64}$/i.test(error) ? (error === "access_denied" ? "canceled" : "incomplete") : null;

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const locale = await resolveLocale(params);
  const query = await searchParams;
  const error = authError(query.error);
  // HEY-73: Better Auth's fallback error URL carries only the error (e.g. cancelling again after Back to Google).
  // The guest's draft waits in the editor, so a retry resumes it there, like the Export sign-in does.
  const next = error && query.next === undefined ? "/create?resume=1" : safeReturnPath(query.next);
  if (await getSession()) redirect({ href: next, locale });
  const t = await getTranslations("auth");
  const local = (path: string) => (locale === "en" ? path : `/${locale}${path}`);
  const callbackURL = local(next);
  // HEY-72: a canceled or failed Google sign-in comes back here (same return target), so the guest draft and a retry
  // stay one click away instead of Better Auth's generic error page.
  const errorCallbackURL = local(`/sign-in?next=${encodeURIComponent(next)}`);
  const fromEditor = next.startsWith("/create");

  return (
    <section className="mx-auto flex max-w-md flex-col px-4 py-16">
      <Card className="items-center gap-6 p-8 text-center">
        <LogoMark className="size-12" />
        <div className="flex flex-col gap-2">
          <h1 className="text-h1">{t("title")}</h1>
          <p className="text-body text-secondary-foreground">{t("lead")}</p>
        </div>
        {error ? (
          <div
            role={error === "canceled" ? "status" : "alert"}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-md px-3.5 py-3 text-left text-body",
              error === "canceled" ? "bg-subtle text-secondary-foreground" : "bg-danger-soft text-danger",
            )}
          >
            {error === "canceled" ? (
              <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{t(fromEditor ? `${error}.draft` : `${error}.plain`)}</span>
          </div>
        ) : null}
        <GoogleSignInButton callbackURL={callbackURL} errorCallbackURL={errorCallbackURL} />
        {error && fromEditor ? (
          <Link href="/create?step=design" className="text-body text-secondary-foreground underline underline-offset-4">
            {t("backToDesign")}
          </Link>
        ) : null}
        <p className="text-caption text-muted-foreground">{t("legal")}</p>
      </Card>
    </section>
  );
}
