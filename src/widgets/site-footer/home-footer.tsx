import { getTranslations } from "next-intl/server";
import { TypeLink } from "@/features/qr-editor";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/shared/ui/logo";

const FOOTER_TYPES = ["website", "wifi", "contact", "event"] as const;
const linkClass =
  "inline-flex min-h-8 items-center py-1.5 text-[0.875rem] text-secondary-foreground underline-offset-3 transition-colors duration-(--motion-fast) hover:text-foreground hover:underline";

/** Design "foot2": brand + Product / Make a code for / Company columns, then a hairline row with © and the small print. */
export async function HomeFooter() {
  const [t, tNav] = await Promise.all([getTranslations("footer"), getTranslations("nav")]);
  return (
    <footer className="mt-6 flex flex-col gap-7 border-t border-border pt-12 pb-7">
      <div className="grid grid-cols-2 gap-x-6 gap-y-7 md:grid-cols-[1.6fr_repeat(3,minmax(0,1fr))]">
        <div className="col-span-full flex max-w-80 flex-col gap-2.5 md:col-span-1">
          <Logo />
          <p className="text-caption text-muted-foreground">{t("tagline")}</p>
        </div>
        <nav aria-label={t("product")} className="flex flex-col items-start gap-1">
          <span className="mb-1.5 text-micro text-muted-foreground uppercase">{t("product")}</span>
          <Link href="/create" className={linkClass}>
            {tNav("createCode")}
          </Link>
          <Link href="/pricing" className={linkClass}>
            {tNav("pricing")}
          </Link>
          <Link href="/dashboard" className={linkClass}>
            {tNav("myCodes")}
          </Link>
        </nav>
        <nav aria-label={t("makeFor")} className="flex flex-col items-start gap-1">
          <span className="mb-1.5 text-micro text-muted-foreground uppercase">{t("makeFor")}</span>
          {FOOTER_TYPES.map((type) => (
            <TypeLink key={type} type={type} className={linkClass} />
          ))}
        </nav>
        <nav aria-label={t("company")} className="flex flex-col items-start gap-1">
          <span className="mb-1.5 text-micro text-muted-foreground uppercase">{t("company")}</span>
          <Link href="/privacy" className={linkClass}>
            {t("privacy")}
          </Link>
          <Link href="/terms" className={linkClass}>
            {t("terms")}
          </Link>
        </nav>
      </div>
      <div className="flex flex-wrap justify-between gap-x-5 gap-y-2 border-t border-border pt-5 text-caption text-muted-foreground">
        <span>{t("rights", { year: new Date().getFullYear() })}</span>
        <span>{t("smallPrint")}</span>
      </div>
    </footer>
  );
}
