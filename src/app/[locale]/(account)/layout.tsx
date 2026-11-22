import { resolveLocale } from "@/i18n/server";
import { Container } from "@/shared/ui/container";

/** Account area: signed-in users only (each page calls requireAccount with its own return path). Design "wrap page": 24 / 32 px padding on phones, 40 / 64 px from 1024 px. */
export default async function AccountLayout({ children, params }: LayoutProps<"/[locale]">) {
  await resolveLocale(params);
  return <Container className="flex flex-col gap-6 pt-6 pb-8 lg:pt-10 lg:pb-16">{children}</Container>;
}
