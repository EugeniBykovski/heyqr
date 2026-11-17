import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/server";
import { getSession } from "@/server/auth";
import { Container } from "@/shared/ui/container";

/** Account area: signed-in users only. Design "wrap page": 24 / 32 px padding on phones, 40 / 64 px from 1024 px. */
export default async function AccountLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  if (!(await getSession())) redirect({ href: "/sign-in?next=/dashboard", locale });
  return <Container className="flex flex-col gap-6 pt-6 pb-8 lg:pt-10 lg:pb-16">{children}</Container>;
}
