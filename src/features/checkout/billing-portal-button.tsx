"use client";

import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { openBillingPortal } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";

/**
 * Stripe's Customer Portal (HEY-139): its home ("manage"), the payment method update ("payment") or the switch to Studio
 * ("upgrade"). The server resolves the account's Customer, checks the Portal allows it and builds the return URL.
 */
export function BillingPortalButton({
  label,
  intent = "manage",
  variant = "secondary",
}: {
  label?: string;
  intent?: "manage" | "payment" | "upgrade" | "recover";
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      aria-busy={pending || undefined}
      data-portal={intent}
      onClick={() =>
        start(async () => {
          const result = await openBillingPortal(locale, intent).catch(() => ({ ok: false, error: "failed" }) as const);
          if (result.ok) window.location.assign(result.data.url);
          // No Stripe account yet, or an action this account or the Portal can't do now: say so; anything else: retry.
          else
            toast.error(
              result.error === "not_found"
                ? t("portal.noCustomer")
                : result.error === "invalid"
                  ? t("portal.unavailable")
                  : t("portal.failed"),
              { id: "billing-portal" },
            );
        })
      }
    >
      {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
      {label ?? t("manage")}
      {label || pending ? null : <ExternalLinkIcon aria-hidden />}
    </Button>
  );
}
