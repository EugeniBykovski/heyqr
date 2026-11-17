"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { openBillingPortal } from "@/server/actions/qr";
import { Button } from "@/shared/ui/button";

export function BillingPortalButton() {
  const t = useTranslations("billing");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await openBillingPortal(locale);
          if (result.ok) window.location.assign(result.data.url);
          else toast.error(tErrors("generic"));
        })
      }
    >
      {t("manage")}
      <ExternalLinkIcon aria-hidden />
    </Button>
  );
}
