import { redirect } from "@/i18n/navigation";
import { getSession } from "@/server/auth";
import { resolveLocale } from "@/i18n/server";

/** Account area: signed-in users only. */
export default async function AccountLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  if (!(await getSession())) redirect({ href: "/sign-in?next=/dashboard", locale });
  return <div className="mx-auto flex max-w-wide flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">{children}</div>;
}
