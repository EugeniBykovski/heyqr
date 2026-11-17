import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/shared/ui/logo";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-2">
          <Logo />
          <p className="text-caption text-muted-foreground">{t("tagline")}</p>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-4 text-caption text-secondary-foreground">
          <Link href="/terms" className="hover:text-foreground hover:underline">
            {t("terms")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            {t("privacy")}
          </Link>
          <span>{t("rights", { year: new Date().getFullYear() })}</span>
        </nav>
      </div>
    </footer>
  );
}
