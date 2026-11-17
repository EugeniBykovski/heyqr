import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const linkClass = "rounded-xs underline-offset-3 transition-colors duration-(--motion-fast) hover:text-foreground hover:underline";

/** Design "foot": one hairline row in the page container: copyright, then Pricing / Privacy / Terms. */
export async function SiteFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="mx-auto w-full max-w-page px-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-border pt-5 pb-8 text-caption text-muted-foreground">
        <span>{t("rights", { year: new Date().getFullYear() })}</span>
        <nav aria-label={t("label")} className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/pricing" className={linkClass}>
            {t("pricing")}
          </Link>
          <Link href="/privacy" className={linkClass}>
            {t("privacy")}
          </Link>
          <Link href="/terms" className={linkClass}>
            {t("terms")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
