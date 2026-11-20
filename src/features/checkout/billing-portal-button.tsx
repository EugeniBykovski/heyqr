"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { openBillingPortal } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";

/** Stripe's billing portal: plan changes (e.g. Starter → Studio), cancellation, payment method and invoices. */
export function BillingPortalButton({ label, variant = "secondary" }: { label?: string; variant?: "primary" | "secondary" }) {
  const t = useTranslations("billing");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await openBillingPortal(locale);
          if (result.ok) window.location.assign(result.data.url);
          else toast.error(tErrors("generic"));
        })
      }
    >
      {label ?? t("manage")}
      {label ? null : <ExternalLinkIcon aria-hidden />}
    </Button>
  );
}
