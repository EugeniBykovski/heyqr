import { useId } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/shared/lib/utils";

const linkClass = "font-semibold text-foreground underline underline-offset-3";

/**
 * HEY-109: what a buyer should know before leaving Hey QR for Stripe. Single QR is one payment, not a subscription
 * (the catalog price, tax added by Stripe); it's paid on Stripe's hosted checkout; the receipt is in Billing (each
 * paid purchase links Stripe's receipt); and where to get help. Terms, Privacy and the support contact are linked.
 * The support line and link appear only with a confirmed contact (SUPPORT_EMAIL), never a placeholder.
 */
export function PaymentInfo({
  price,
  support,
  compact = false,
  className,
}: {
  price?: string;
  support: string | null;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("payment");
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-2", compact ? "text-caption text-secondary-foreground" : "text-[0.9375rem]", className)}
    >
      <h2 id={id} className={compact ? "text-label text-foreground" : "text-h3"}>
        {t("title")}
      </h2>
      <ul className={cn("flex flex-col gap-1.5", compact ? "" : "text-secondary-foreground")}>
        {price ? <li>{t("oneTime", { price })}</li> : null}
        <li>{t("where")}</li>
        <li>{t("receipt")}</li>
        {support ? (
          <li>
            {t.rich("support", {
              email: support,
              link: (chunks) => (
                <a href={`mailto:${support}`} className={linkClass}>
                  {chunks}
                </a>
              ),
            })}
          </li>
        ) : null}
      </ul>
      <nav aria-label={t("title")} className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/terms" className={linkClass}>
          {t("terms")}
        </Link>
        <Link href="/privacy" className={linkClass}>
          {t("privacy")}
        </Link>
        {support ? (
          <a href={`mailto:${support}`} className={linkClass}>
            {t("supportLink")}
          </a>
        ) : null}
      </nav>
    </section>
  );
}
